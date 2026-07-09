// ============================================================
//  POS BACKEND  src/orders/orders.service.ts
//  >> CHEP DE (reprintBill)
// ============================================================

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrintingService } from '../printing/printing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AddItemsDto } from './dto/add-items.dto';
import {
  OrderItemRow,
  OrderLineView,
  OrderSessionRow,
  OrderSessionView,
  PaymentMethod,
} from './types/order.types';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly printing: PrintingService,
    private readonly realtime: RealtimeGateway,
    private readonly dashboard: DashboardService,
  ) {}

  // =========================================================================
  //  TẠO / LẤY PHIÊN
  // =========================================================================

  /**
   * Khách quét QR tại bàn (?table=04): lấy phiên đang mở của bàn,
   * không có thì tạo mới. Khóa row bàn (FOR UPDATE) để 2 lượt quét đồng thời
   * không tạo trùng phiên.
   */
  async getOrCreateTableSession(tableNumber: string): Promise<OrderSessionView> {
    const sessionId = await this.db.transaction(async (client) => {
      const table = await client.query<{ id: number }>(
        `SELECT id FROM tables WHERE table_number = $1 AND is_active = TRUE FOR UPDATE`,
        [tableNumber],
      );
      const tableRow = table.rows[0];
      if (!tableRow) {
        throw new NotFoundException(`Không tìm thấy bàn ${tableNumber}`);
      }

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM order_sessions
          WHERE table_id = $1 AND status IN ('UNPAID', 'PENDING_CASH')
          LIMIT 1`,
        [tableRow.id],
      );
      if (existing.rows[0]) return existing.rows[0].id;

      const created = await client.query<{ id: number }>(
        `INSERT INTO order_sessions (order_code, table_id, channel, status)
         VALUES ($1, $2, 'TABLE_QR', 'UNPAID')
         RETURNING id`,
        [this.genOrderCode(), tableRow.id],
      );
      await client.query(`UPDATE tables SET status = 'OCCUPIED' WHERE id = $1`, [
        tableRow.id,
      ]);
      return created.rows[0].id;
    });

    return this.buildSessionView(sessionId);
  }

  /** Thu ngân lên đơn tại quầy. Có thể gán bàn hoặc để trống (mang đi). */
  async createCounterSession(tableNumber?: string): Promise<OrderSessionView> {
    const sessionId = await this.db.transaction(async (client) => {
      let tableId: number | null = null;
      if (tableNumber) {
        const t = await client.query<{ id: number }>(
          `SELECT id FROM tables WHERE table_number = $1 AND is_active = TRUE FOR UPDATE`,
          [tableNumber],
        );
        const row = t.rows[0];
        if (!row) throw new NotFoundException(`Không tìm thấy bàn ${tableNumber}`);
        tableId = row.id;
      }

      try {
        const created = await client.query<{ id: number }>(
          `INSERT INTO order_sessions (order_code, table_id, channel, status)
           VALUES ($1, $2, 'COUNTER_POS', 'UNPAID')
           RETURNING id`,
          [this.genOrderCode(), tableId],
        );
        if (tableId) {
          await client.query(`UPDATE tables SET status = 'OCCUPIED' WHERE id = $1`, [
            tableId,
          ]);
        }
        return created.rows[0].id;
      } catch (e: any) {
        // Ràng buộc vàng: 1 bàn chỉ 1 phiên mở
        if (e?.code === '23505' && e?.constraint === 'uq_active_session_per_table') {
          throw new BadRequestException(`Bàn ${tableNumber} đang có đơn mở`);
        }
        throw e;
      }
    });

    return this.buildSessionView(sessionId);
  }

  // =========================================================================
  //  THÊM / HỦY MÓN  (APPEND-ONLY)
  // =========================================================================

  /**
   * Thêm món vào đơn. Mỗi món = 1 dòng PRODUCT (cha) mới + các dòng OPTION (con).
   * KHÔNG cập nhật dòng cũ -> nhiều nguồn thêm cùng lúc không xung đột.
   * Giá & tên được "snapshot" từ DB phía server, không tin giá từ client.
   */
  async addItems(sessionId: number, dto: AddItemsDto): Promise<OrderSessionView> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (session.status !== 'UNPAID') {
      throw new BadRequestException(
        'Chỉ thêm món khi đơn đang ở trạng thái UNPAID',
      );
    }

    await this.db.transaction(async (client) => {
      for (const item of dto.items) {
        const productRes = await client.query<{
          id: number;
          name: string;
          price: string;
          is_available: boolean;
          is_active: boolean;
        }>(
          `SELECT id, name, price, is_available, is_active
             FROM products WHERE id = $1`,
          [item.productId],
        );
        const product = productRes.rows[0];
        if (!product) {
          throw new BadRequestException(`Món #${item.productId} không tồn tại`);
        }
        if (!product.is_active || !product.is_available) {
          throw new BadRequestException(`Món "${product.name}" hiện không bán`);
        }

        const parentRes = await client.query<{ id: number }>(
          `INSERT INTO order_items
             (session_id, item_type, product_id, name_snapshot, unit_price, quantity, note)
           VALUES ($1, 'PRODUCT', $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            sessionId,
            product.id,
            product.name,
            product.price,
            item.quantity,
            item.note ?? null,
          ],
        );
        const parentId = parentRes.rows[0].id;

        for (const opt of item.options ?? []) {
          const optionRes = await client.query<{
            id: number;
            name: string;
            price: string;
          }>(
            `SELECT id, name, price FROM options WHERE id = $1 AND is_active = TRUE`,
            [opt.optionId],
          );
          const option = optionRes.rows[0];
          if (!option) {
            throw new BadRequestException(
              `Topping #${opt.optionId} không khả dụng`,
            );
          }
          // Số lượng topping = số lượng món (combo đồng nhất).
          await client.query(
            `INSERT INTO order_items
               (session_id, parent_item_id, item_type, option_id, name_snapshot, unit_price, quantity)
             VALUES ($1, $2, 'OPTION', $3, $4, $5, $6)`,
            [sessionId, parentId, option.id, option.name, option.price, item.quantity],
          );
        }
      }
    });

    this.realtime.emitOrderUpdated(sessionId, session.table_number);
    return this.buildSessionView(sessionId);
  }

  /** Hủy 1 món (và topping con của nó) bằng cờ VOIDED. Chỉ khi đơn UNPAID. */
  async voidItem(itemId: number): Promise<OrderSessionView> {
    const sessionId = await this.db.transaction(async (client) => {
      const res = await client.query<{ session_id: number; status: string }>(
        `SELECT i.session_id, s.status
           FROM order_items i JOIN order_sessions s ON s.id = i.session_id
          WHERE i.id = $1`,
        [itemId],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException(`Không tìm thấy món #${itemId}`);
      if (row.status !== 'UNPAID') {
        throw new BadRequestException('Chỉ hủy món khi đơn đang UNPAID');
      }

      await client.query(
        `UPDATE order_items SET status = 'VOIDED', voided_at = NOW()
          WHERE id = $1 AND status = 'ACTIVE'`,
        [itemId],
      );
      await client.query(
        `UPDATE order_items SET status = 'VOIDED', voided_at = NOW()
          WHERE parent_item_id = $1 AND status = 'ACTIVE'`,
        [itemId],
      );
      return row.session_id;
    });

    const session = await this.getSessionRow(sessionId);
    this.realtime.emitOrderUpdated(sessionId, session?.table_number ?? null);
    return this.buildSessionView(sessionId);
  }

  // =========================================================================
  //  KỊCH BẢN NGHIỆP VỤ — chuyển trạng thái
  // =========================================================================

  /**
   * Chọn thanh toán TIỀN MẶT. Dùng chung cho:
   *  - KB1 (COUNTER_POS): thu ngân bấm "Thanh toán tiền mặt" -> KHÔNG in,
   *    KHÔNG ghim cảnh báo (thu ngân ở ngay quầy). In khi xác nhận đã nhận tiền.
   *  - KB2 (TABLE_QR): khách bấm "Trả tiền mặt tại quầy" -> in NGAY 2 liên
   *    (liên 2 đưa bếp làm đồ) + ghim cảnh báo nổi trên màn hình POS.
   */
  async chooseCashPayment(sessionId: number): Promise<OrderSessionView> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (session.status !== 'UNPAID') {
      throw new BadRequestException('Chỉ chọn thanh toán khi đơn đang UNPAID');
    }

    const total = await this.calcActiveTotal(sessionId);
    if (total <= 0) {
      throw new BadRequestException('Đơn chưa có món, không thể thanh toán');
    }

    await this.db.query(
      `UPDATE order_sessions SET status = 'PENDING_CASH', payment_method = 'CASH'
        WHERE id = $1 AND status = 'UNPAID'`,
      [sessionId],
    );

    if (session.channel === 'TABLE_QR') {
      const view = await this.buildSessionView(sessionId);
      await this.printing.printDualBill(view); // in ngay 2 liên
      await this.db.query(
        `UPDATE order_sessions SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL`,
        [sessionId],
      );
      this.realtime.emitPendingCash({
        sessionId,
        orderCode: session.order_code,
        tableNumber: session.table_number,
        amount: view.total,
      });
    }

    return this.buildSessionView(sessionId);
  }

  /**
   * Xác nhận ĐÃ NHẬN TIỀN MẶT -> chốt PAID (KB1 bước 2 & KB2 cuối).
   *  - KB1 (COUNTER_POS): in 2 liên tại bước này.
   *  - KB2 (TABLE_QR): đã in từ lúc chọn tiền mặt -> KHÔNG in lại.
   */
  async confirmCashReceived(sessionId: number): Promise<OrderSessionView> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (session.status !== 'PENDING_CASH' || session.payment_method !== 'CASH') {
      throw new BadRequestException('Đơn không ở trạng thái chờ thu tiền mặt');
    }

    await this.db.transaction((client) =>
      this.markSessionPaid(client, sessionId, 'CASH'),
    );

    if (session.channel === 'COUNTER_POS') {
      const view = await this.buildSessionView(sessionId);
      await this.printing.printDualBill(view);
      await this.db.query(
        `UPDATE order_sessions SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL`,
        [sessionId],
      );
    }

    this.realtime.emitOrderPaid({
      sessionId,
      tableNumber: session.table_number,
      paymentMethod: 'CASH',
    });
    await this.dashboard.broadcastTodayRevenue();

    return this.buildSessionView(sessionId);
  }

  /**
   * Chọn CHUYỂN KHOẢN — luồng mặc định & Kịch bản 3 ("quay xe" từ PENDING_CASH).
   * Trả về thông tin để dựng VietQR động. Việc sinh mã VietQR thực tế + nhận
   * webhook ngân hàng -> gọi markSessionPaid('BANK_TRANSFER') làm ở Phần 2.4.
   */
  async prepareBankTransfer(
    sessionId: number,
  ): Promise<{ orderCode: string; amount: number }> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (session.status !== 'UNPAID' && session.status !== 'PENDING_CASH') {
      throw new BadRequestException('Đơn không thể chuyển sang chuyển khoản');
    }
    const amount = await this.calcActiveTotal(sessionId);
    if (amount <= 0) throw new BadRequestException('Đơn chưa có món');
    return { orderCode: session.order_code, amount };
  }

  /**
   * Webhook ngân hàng xác nhận đã chuyển khoản -> chốt PAID (BANK_TRANSFER).
   *  - Luồng CK mặc định (đơn đang UNPAID): chưa in -> in 2 liên bây giờ.
   *  - Kịch bản 3 (đơn đang PENDING_CASH, khách "quay xe"): đã in lúc chọn
   *    tiền mặt -> KHÔNG in lại, chỉ tắt cảnh báo ghim trên POS.
   * Trả false nếu đơn đã PAID sẵn (idempotent).
   */
  async confirmBankTransferPaid(sessionId: number): Promise<boolean> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (session.status === 'PAID') return false;
    const priorStatus = session.status;

    const changed = await this.db.transaction((client) =>
      this.markSessionPaid(client, sessionId, 'BANK_TRANSFER'),
    );
    if (!changed) return false;

    if (priorStatus === 'UNPAID') {
      const view = await this.buildSessionView(sessionId);
      await this.printing.printDualBill(view);
    }

    this.realtime.emitOrderPaid({
      sessionId,
      tableNumber: session.table_number,
      paymentMethod: 'BANK_TRANSFER',
    });
    // Phần 2.5: cộng dồn & đẩy doanh thu real-time.

    return true;
  }

  /**
   * Chốt PAID nguyên tử (dùng chung cho tiền mặt ở 2.2 và webhook ở 2.4):
   * khóa phiên, tính tổng món ACTIVE, đóng băng total_amount, set completed_at
   * + payment_method, đóng bàn về EMPTY.
   * Trả về true nếu vừa chuyển; false nếu đã PAID sẵn (idempotent — chống webhook trùng).
   */
  async markSessionPaid(
    client: PoolClient,
    sessionId: number,
    method: PaymentMethod,
  ): Promise<boolean> {
    const locked = await client.query<OrderSessionRow>(
      `SELECT * FROM order_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    const s = locked.rows[0];
    if (!s) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);
    if (s.status === 'PAID') return false;

    const sum = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(line_total), 0) AS total
         FROM order_items WHERE session_id = $1 AND status = 'ACTIVE'`,
      [sessionId],
    );

    await client.query(
      `UPDATE order_sessions
          SET status = 'PAID', payment_method = $2, total_amount = $3, completed_at = NOW()
        WHERE id = $1`,
      [sessionId, method, sum.rows[0].total],
    );

    if (s.table_id) {
      await client.query(`UPDATE tables SET status = 'EMPTY' WHERE id = $1`, [
        s.table_id,
      ]);
    }
    return true;
  }

  /**
   * In bill nếu đơn CHƯA từng in. Dùng cho luồng webhook chuyển khoản:
   *  - CK mặc định (đơn chưa in) -> in.
   *  - Kịch bản 3 (đã chọn tiền mặt -> đã in -> quay xe sang CK) -> KHÔNG in lại.
   */
  /** In lại bill theo yêu cầu (thu ngân bấm nút). Luôn in, kể cả đã in rồi. */
  async reprintBill(sessionId: number): Promise<{ ok: boolean }> {
    const session = await this.getSessionRow(sessionId);
    if (!session) return { ok: false };
    const view = await this.buildSessionView(sessionId);
    await this.printing.printDualBill(view);
    return { ok: true };
  }

  async printBillIfNeeded(sessionId: number): Promise<void> {
    const session = await this.getSessionRow(sessionId);
    if (!session || session.printed_at) return;
    const view = await this.buildSessionView(sessionId);
    await this.printing.printDualBill(view);
    await this.db.query(
      `UPDATE order_sessions SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL`,
      [sessionId],
    );
  }

  /**
   * Danh sách cảnh báo "đòi tiền mặt" đang chờ (chỉ đơn TABLE_QR — đúng tập
   * mà emitPendingCash phát ra). Dùng cho POS tải lại không mất cảnh báo ghim.
   * Bám partial index idx_sessions_pending_cash.
   */
  async listPendingCash() {
    const rows = await this.db.query<{
      sessionId: number;
      orderCode: string;
      tableNumber: string | null;
      amount: string;
    }>(
      `SELECT s.id AS "sessionId",
              s.order_code AS "orderCode",
              t.table_number AS "tableNumber",
              COALESCE((SELECT SUM(line_total) FROM order_items i
                         WHERE i.session_id = s.id AND i.status = 'ACTIVE'), 0) AS amount
         FROM order_sessions s
         LEFT JOIN tables t ON t.id = s.table_id
        WHERE s.status = 'PENDING_CASH' AND s.channel = 'TABLE_QR'
        ORDER BY s.created_at`,
    );
    return rows.map((r) => ({
      sessionId: r.sessionId,
      orderCode: r.orderCode,
      tableNumber: r.tableNumber,
      amount: Number(r.amount),
    }));
  }

  // =========================================================================
  //  HELPER
  // =========================================================================

  /** Lấy session row kèm table_number (JOIN tables). */
  private getSessionRow(sessionId: number): Promise<OrderSessionRow | null> {
    return this.db.queryOne<OrderSessionRow>(
      `SELECT s.*, t.table_number
         FROM order_sessions s LEFT JOIN tables t ON t.id = s.table_id
        WHERE s.id = $1`,
      [sessionId],
    );
  }

  /** Tổng tiền các món ACTIVE (giỏ hiện tại — tính từ append-only ledger). */
  private async calcActiveTotal(sessionId: number): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(line_total), 0) AS total
         FROM order_items WHERE session_id = $1 AND status = 'ACTIVE'`,
      [sessionId],
    );
    return Number(row?.total ?? 0);
  }

  /** Dựng cấu trúc đơn (gom topping con vào món cha) trả về cho client. */
  async buildSessionView(sessionId: number): Promise<OrderSessionView> {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Không tìm thấy phiên #${sessionId}`);

    const items = await this.db.query<OrderItemRow>(
      `SELECT * FROM order_items
        WHERE session_id = $1 AND status = 'ACTIVE'
        ORDER BY created_at, id`,
      [sessionId],
    );

    const lineMap = new Map<number, OrderLineView>();
    const children: OrderItemRow[] = [];

    for (const it of items) {
      if (it.item_type === 'PRODUCT') {
        lineMap.set(it.id, {
          id: it.id,
          productId: it.product_id,
          name: it.name_snapshot,
          unitPrice: Number(it.unit_price),
          quantity: it.quantity,
          note: it.note,
          toppings: [],
          lineTotal: Number(it.line_total),
        });
      } else {
        children.push(it);
      }
    }

    for (const c of children) {
      const parent =
        c.parent_item_id != null ? lineMap.get(c.parent_item_id) : undefined;
      if (!parent) continue;
      parent.toppings.push({
        id: c.id,
        optionId: c.option_id,
        name: c.name_snapshot,
        unitPrice: Number(c.unit_price),
        quantity: c.quantity,
        lineTotal: Number(c.line_total),
      });
      parent.lineTotal += Number(c.line_total);
    }

    const lines = [...lineMap.values()];
    const total = lines.reduce((acc, l) => acc + l.lineTotal, 0);

    return {
      id: session.id,
      orderCode: session.order_code,
      tableId: session.table_id,
      tableNumber: session.table_number ?? null,
      channel: session.channel,
      status: session.status,
      paymentMethod: session.payment_method,
      lines,
      total,
      createdAt: session.created_at,
    };
  }

  /** Sinh mã đơn (nhúng vào nội dung VietQR). Alphanumeric, đủ duy nhất thực tế. */
  private genOrderCode(): string {
    const ts = Date.now().toString(36).toUpperCase().slice(-6);
    const rand = Math.random().toString(36).toUpperCase().slice(2, 5);
    return `HD${ts}${rand}`;
  }
}