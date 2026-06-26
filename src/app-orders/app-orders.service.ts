import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PrintingService } from '../printing/printing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ReceiveAppOrderDto } from './dto/receive-app-order.dto';
import { AppOrderItem, AppOrderView, PrepStatus } from './app-orders.types';

interface AppOrderRow {
  id: string; // BIGINT -> đã parse thành number bởi DatabaseService, nhưng để string-safe
  app_order_id: string;
  order_code: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  payment_method: 'COD' | 'BANK_QR';
  payment_status: 'PENDING' | 'PAID';
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: AppOrderItem[]; // pg parse JSONB -> object
  total_amount: number;
  prep_status: PrepStatus;
  note: string | null;
  received_at: Date;
}

@Injectable()
export class AppOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly printing: PrintingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // =========================================================================
  //  NHẬN ĐƠN TỪ APP (gọi qua mạng nội bộ)
  // =========================================================================
  /**
   * Lưu đơn online, IN PHIẾU BẾP, bắn realtime cho thu ngân.
   * Idempotent: app_order_id UNIQUE + ON CONFLICT DO NOTHING -> gửi lại không trùng.
   */
  async receiveFromApp(dto: ReceiveAppOrderDto): Promise<{ ok: true; id: number; duplicated: boolean }> {
    const inserted = await this.db.queryOne<{ id: number }>(
      `INSERT INTO app_orders
         (app_order_id, order_code, fulfillment, payment_method, payment_status,
          customer_name, customer_phone, customer_address, items, total_amount, prep_status, note, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12, COALESCE($13::timestamptz, NOW()))
       ON CONFLICT (app_order_id) DO NOTHING
       RETURNING id`,
      [
        dto.appOrderId,
        dto.orderCode,
        dto.fulfillment,
        dto.paymentMethod,
        dto.paymentStatus ?? 'PENDING',
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

    // Ghi nhận event đã xử lý (chống trùng theo eventId — phụ trợ).
    await this.db.query(
      `INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [dto.eventId],
    );

    if (!inserted) {
      // Đã nhận đơn này trước đó.
      const existing = await this.getRowByAppId(dto.appOrderId);
      return { ok: true, id: existing ? Number(existing.id) : 0, duplicated: true };
    }

    const view = await this.getViewById(Number(inserted.id));

    // In phiếu bếp (best-effort, lỗi máy in không chặn).
    await this.printing.printAppOrder(view);
    await this.db.query(`UPDATE app_orders SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL`, [inserted.id]);

    // Bắn realtime cho màn thu ngân.
    this.realtime.emitAppOrderIncoming({
      id: view.id,
      appOrderId: view.appOrderId,
      orderCode: view.orderCode,
      fulfillment: view.fulfillment,
      total: view.totalAmount,
      customerName: view.customerName,
      itemCount: view.items.length,
    });

    return { ok: true, id: view.id, duplicated: false };
  }

  // =========================================================================
  //  CHO MÀN THU NGÂN
  // =========================================================================
  /** Danh sách đơn online đang hoạt động (chưa giao xong / chưa hủy). */
  async listActive(): Promise<AppOrderView[]> {
    const rows = await this.db.query<AppOrderRow>(
      `SELECT * FROM app_orders
        WHERE prep_status NOT IN ('DELIVERED', 'CANCELLED')
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

    // Đẩy trạng thái về App (worker outbox sẽ POST /internal/orders/status).
    await this.db.query(
      `INSERT INTO sync_outbox (event_type, payload) VALUES ('app_order.status', $1)`,
      [JSON.stringify({ appOrderId, status })],
    );

    const view = await this.getViewByAppId(appOrderId);
    this.realtime.emitAppOrderStatus({
      id: view.id,
      appOrderId: view.appOrderId,
      orderCode: view.orderCode,
      prepStatus: view.prepStatus,
    });
    return view;
  }

  // =========================================================================
  //  HELPER
  // =========================================================================
  private getRowByAppId(appOrderId: string): Promise<AppOrderRow | null> {
    return this.db.queryOne<AppOrderRow>(`SELECT * FROM app_orders WHERE app_order_id = $1`, [appOrderId]);
  }

  private async getViewById(id: number): Promise<AppOrderView> {
    const row = await this.db.queryOne<AppOrderRow>(`SELECT * FROM app_orders WHERE id = $1`, [id]);
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