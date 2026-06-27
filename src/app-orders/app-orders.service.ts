import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrintingService } from '../printing/printing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ReceiveAppOrderDto } from './dto/receive-app-order.dto';
import { AppOrderItem, AppOrderView, PrepStatus } from './app-orders.types';

interface AppOrderRow {
  id: string;
  app_order_id: string;
  order_code: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  payment_method: 'COD' | 'BANK_QR';
  payment_status: 'PENDING' | 'PAID';
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: AppOrderItem[];
  total_amount: number;
  prep_status: PrepStatus;
  note: string | null;
  received_at: Date;
}

@Injectable()
export class AppOrdersService {
  private readonly logger = new Logger('AppOrders');
  constructor(
    private readonly db: DatabaseService,
    private readonly printing: PrintingService,
    private readonly realtime: RealtimeGateway,
    private readonly dashboard: DashboardService, // @Global -> không cần import module
  ) {}

  // =========================================================================
  //  NHẬN ĐƠN TỪ APP (gọi qua mạng nội bộ)
  // =========================================================================
  /**
   * Lưu đơn online, IN PHIẾU BẾP, bắn realtime cho thu ngân.
   * Idempotent: app_order_id UNIQUE + ON CONFLICT DO NOTHING -> gửi lại không trùng.
   * Đơn BANK_QR đẩy sang khi đã trả -> set paid_at + cộng doanh thu ngay.
   */
  async receiveFromApp(
    dto: ReceiveAppOrderDto,
  ): Promise<{ ok: true; id: number; duplicated: boolean }> {
    const paymentStatus = dto.paymentStatus ?? 'PENDING';

    const inserted = await this.db.queryOne<{ id: number }>(
      `INSERT INTO app_orders
         (app_order_id, order_code, fulfillment, payment_method, payment_status,
          customer_name, customer_phone, customer_address, items, total_amount,
          prep_status, note, received_at, paid_at)
       VALUES ($1,$2,$3,$4,$5::text,$6,$7,$8,$9::jsonb,$10,$11,$12,
               COALESCE($13::timestamptz, NOW()),
               CASE WHEN $5::text = 'PAID' THEN NOW() ELSE NULL END)
       ON CONFLICT (app_order_id) DO NOTHING
       RETURNING id`,
      [
        dto.appOrderId,
        dto.orderCode,
        dto.fulfillment,
        dto.paymentMethod,
        paymentStatus,
        dto.customer?.name ?? null,
        dto.customer?.phone ?? null,
        dto.customer?.address ?? null,
        JSON.stringify(dto.items),
        dto.totalAmount,
        dto.status ?? 'CONFIRMED',
        dto.note ?? null,
        dto.createdAt ?? null,
      ],
    );

    await this.db.query(
      `INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [dto.eventId],
    );

    if (!inserted) {
      const existing = await this.getRowByAppId(dto.appOrderId);
      return { ok: true, id: existing ? Number(existing.id) : 0, duplicated: true };
    }

    const view = await this.getViewById(Number(inserted.id));

    // In phiếu bếp chạy NỀN — không để máy in làm treo response trả về App.
    void this.printing
      .printAppOrder(view)
      .then(() =>
        this.db.query(
          `UPDATE app_orders SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL`,
          [inserted.id],
        ),
      )
      .catch((e) =>
        this.logger.warn(
          `In đơn ${view.orderCode} lỗi nền: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    this.realtime.emitAppOrderIncoming({
      id: view.id,
      appOrderId: view.appOrderId,
      orderCode: view.orderCode,
      fulfillment: view.fulfillment,
      total: view.totalAmount,
      customerName: view.customerName,
      itemCount: view.items.length,
    });

    // Đơn đã trả trước (BANK_QR) -> cộng doanh thu ngay.
    if (paymentStatus === 'PAID') {
      void this.dashboard.broadcastTodayRevenue();
    }

    return { ok: true, id: view.id, duplicated: false };
  }

  // =========================================================================
  //  CHO MÀN THU NGÂN
  // =========================================================================
  /**
   * Đơn online đang cần xử lý: chưa hủy VÀ chưa (giao xong + đã thu tiền).
   * -> đơn COD đã giao nhưng CHƯA thu tiền vẫn hiện để bấm "Đã thu tiền".
   */
  async listActive(): Promise<AppOrderView[]> {
    const rows = await this.db.query<AppOrderRow>(
      `SELECT * FROM app_orders
        WHERE prep_status <> 'CANCELLED'
          AND NOT (prep_status = 'DELIVERED' AND payment_status = 'PAID')
        ORDER BY received_at`,
    );
    return rows.map((r) => this.toView(r));
  }

  /** Thu ngân đổi trạng thái chế biến -> cập nhật + đẩy về App qua outbox. */
  async updateStatus(appOrderId: string, status: PrepStatus): Promise<AppOrderView> {
    const row = await this.getRowByAppId(appOrderId);
    if (!row) throw new NotFoundException(`Không tìm thấy đơn online ${appOrderId}`);
    if (row.prep_status === 'DELIVERED' || row.prep_status === 'CANCELLED') {
      throw new BadRequestException('Đơn đã kết thúc, không đổi trạng thái được');
    }

    await this.db.query(
      `UPDATE app_orders SET prep_status = $2, updated_at = NOW() WHERE app_order_id = $1`,
      [appOrderId, status],
    );

    // Đẩy trạng thái về App (worker outbox -> POST /internal/orders/status).
    await this.db.query(
      `INSERT INTO sync_outbox (event_type, payload) VALUES ('app_order.status', $1)`,
      [JSON.stringify({ appOrderId, status })],
    );

    const view = await this.getViewByAppId(appOrderId);
    this.emitStatus(view);
    return view;
  }

  /** Xác nhận đã thu tiền (chủ yếu cho COD sau khi giao) -> ghi nhận doanh thu. */
  async confirmPayment(appOrderId: string): Promise<AppOrderView> {
    const row = await this.getRowByAppId(appOrderId);
    if (!row) throw new NotFoundException(`Không tìm thấy đơn online ${appOrderId}`);
    if (row.payment_status === 'PAID') {
      return this.toView(row); // đã thu rồi -> idempotent
    }

    await this.db.query(
      `UPDATE app_orders
          SET payment_status = 'PAID', paid_at = NOW(), updated_at = NOW()
        WHERE app_order_id = $1`,
      [appOrderId],
    );

    const view = await this.getViewByAppId(appOrderId);
    this.emitStatus(view);
    void this.dashboard.broadcastTodayRevenue();
    return view;
  }

  // =========================================================================
  //  KHÁCH HỦY ĐƠN TỪ APP (App gọi qua mạng nội bộ)
  // =========================================================================
  /**
   * App báo khách đã hủy -> set CANCELLED + cảnh báo các máy POS (chuông + thẻ đỏ).
   * KHÔNG đẩy ngược lại App (App đã tự cập nhật + báo khách rồi).
   */
  async cancelFromApp(
    appOrderId: string,
  ): Promise<{ ok: true; applied: boolean }> {
    const row = await this.getRowByAppId(appOrderId);
    // Đơn chưa từng đẩy sang POS (vd BANK_QR chưa trả) -> bỏ qua êm.
    if (!row) return { ok: true, applied: false };
    if (row.prep_status === 'DELIVERED' || row.prep_status === 'CANCELLED') {
      return { ok: true, applied: false }; // quá muộn / đã hủy
    }

    await this.db.query(
      `UPDATE app_orders SET prep_status = 'CANCELLED', updated_at = NOW() WHERE app_order_id = $1`,
      [appOrderId],
    );

    const view = await this.getViewByAppId(appOrderId);
    this.realtime.emitAppOrderCancelled({
      id: view.id,
      appOrderId: view.appOrderId,
      orderCode: view.orderCode,
    });
    return { ok: true, applied: true };
  }

  // =========================================================================
  //  HELPER
  // =========================================================================
  private emitStatus(view: AppOrderView): void {
    this.realtime.emitAppOrderStatus({
      id: view.id,
      appOrderId: view.appOrderId,
      orderCode: view.orderCode,
      prepStatus: view.prepStatus,
      paymentStatus: view.paymentStatus,
    });
  }

  private getRowByAppId(appOrderId: string): Promise<AppOrderRow | null> {
    return this.db.queryOne<AppOrderRow>(
      `SELECT * FROM app_orders WHERE app_order_id = $1`,
      [appOrderId],
    );
  }

  private async getViewById(id: number): Promise<AppOrderView> {
    const row = await this.db.queryOne<AppOrderRow>(
      `SELECT * FROM app_orders WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException(`Không tìm thấy đơn online #${id}`);
    return this.toView(row);
  }

  private async getViewByAppId(appOrderId: string): Promise<AppOrderView> {
    const row = await this.getRowByAppId(appOrderId);
    if (!row) throw new NotFoundException(`Không tìm thấy đơn online ${appOrderId}`);
    return this.toView(row);
  }

  private toView(r: AppOrderRow): AppOrderView {
    return {
      id: Number(r.id),
      appOrderId: r.app_order_id,
      orderCode: r.order_code,
      fulfillment: r.fulfillment,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      customerAddress: r.customer_address,
      items: r.items ?? [],
      totalAmount: Number(r.total_amount),
      prepStatus: r.prep_status,
      note: r.note,
      receivedAt: r.received_at,
    };
  }
}