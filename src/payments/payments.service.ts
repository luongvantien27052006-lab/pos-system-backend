import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import { buildVietQrImageUrl, buildVietQrPayload } from './vietqr.util';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly bankBin: string;
  private readonly accountNo: string;
  private readonly accountName: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeGateway,
    private readonly dashboard: DashboardService,
    config: ConfigService,
  ) {
    this.bankBin = config.get<string>('VIETQR_BANK_BIN') ?? '';
    this.accountNo = config.get<string>('VIETQR_ACCOUNT_NO') ?? '';
    this.accountName = config.get<string>('VIETQR_ACCOUNT_NAME') ?? '';
    this.webhookSecret = config.get<string>('BANK_WEBHOOK_SECRET') ?? '';
  }

  /**
   * Sinh VietQR động cho 1 phiên — luồng chuyển khoản mặc định & Kịch bản 3
   * (thu ngân bấm "Hiện mã QR chuyển khoản" ngay trên thanh cảnh báo ghim).
   * Dùng lại prepareBankTransfer của OrdersService để kiểm tra trạng thái + số tiền.
   */
  async createQr(sessionId: number) {
    const { orderCode, amount } = await this.orders.prepareBankTransfer(sessionId);
    const input = {
      bankBin: this.bankBin,
      accountNo: this.accountNo,
      amount,
      content: orderCode,
    };
    return {
      orderCode,
      amount,
      bankBin: this.bankBin,
      accountNo: this.accountNo,
      accountName: this.accountName,
      qrPayload: buildVietQrPayload(input), // chuỗi EMVCo để render QR
      qrImageUrl: buildVietQrImageUrl(input, this.accountName), // link ảnh tiện dụng
    };
  }

  /**
   * Nhận webhook SePay -> đối soát -> chốt PAID (idempotent) -> realtime + in.
   *  1. Xác thực header Authorization: Apikey <secret>.
   *  2. Chỉ xử lý tiền VÀO.
   *  3. Trong 1 transaction: tìm đơn theo mã, ghi payment_transactions
   *     (UNIQUE provider_tx_id chống trùng), kiểm tra số tiền, gọi markSessionPaid.
   *  4. Sau commit: nếu vừa PAID -> tắt cảnh báo ghim (realtime) + in nếu chưa in.
   */
  async handleSepayWebhook(authHeader: string | undefined, dto: SepayWebhookDto) {
    if (!this.verifyAuth(authHeader)) {
      throw new UnauthorizedException('Sai API key webhook');
    }
    if (dto.transferType !== 'in' || !(dto.transferAmount > 0)) {
      return { success: true, ignored: true };
    }

    const orderCode = this.extractOrderCode(dto.content ?? '');

    let result: { paid: boolean; sessionId: number | null; note?: string };
    try {
      result = await this.db.transaction(async (client) => {
        let sessionId: number | null = null;
        if (orderCode) {
          const s = await client.query<{ id: number }>(
            `SELECT id FROM order_sessions WHERE order_code = $1 FOR UPDATE`,
            [orderCode],
          );
          if (s.rows[0]) sessionId = s.rows[0].id;
        }

        // Ghi nhận giao dịch — UNIQUE(provider, provider_tx_id) chống xử lý trùng
        await client.query(
          `INSERT INTO payment_transactions
             (provider, provider_tx_id, session_id, order_code, amount, gateway, reference_code, raw_content)
           VALUES ('SEPAY', $1, $2, $3, $4, $5, $6, $7)`,
          [
            String(dto.id),
            sessionId,
            orderCode,
            dto.transferAmount,
            dto.gateway ?? null,
            dto.referenceCode ?? null,
            dto.content ?? null,
          ],
        );

        if (sessionId == null) {
          return { paid: false, sessionId: null, note: 'Tiền về nhưng không khớp mã đơn' };
        }

        const sum = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(line_total), 0) AS total
             FROM order_items WHERE session_id = $1 AND status = 'ACTIVE'`,
          [sessionId],
        );
        if (dto.transferAmount < Number(sum.rows[0].total)) {
          return { paid: false, sessionId, note: 'Số tiền chuyển nhỏ hơn tổng đơn' };
        }

        const paid = await this.orders.markSessionPaid(client, sessionId, 'BANK_TRANSFER');
        return { paid, sessionId };
      });
    } catch (e: any) {
      if (e?.code === '23505' && e?.constraint === 'uq_provider_tx') {
        this.logger.log(`Webhook SePay trùng (tx ${dto.id}) — bỏ qua.`);
        return { success: true, duplicated: true };
      }
      throw e;
    }

    if (result.paid && result.sessionId) {
      const view = await this.orders.buildSessionView(result.sessionId);
      this.realtime.emitOrderPaid({
        sessionId: result.sessionId,
        tableNumber: view.tableNumber,
        paymentMethod: 'BANK_TRANSFER',
      });
      await this.orders.printBillIfNeeded(result.sessionId); // tự bỏ qua nếu đã in (KB3)
      await this.dashboard.broadcastTodayRevenue();
    } else if (result.note) {
      this.logger.warn(`Webhook SePay tx ${dto.id}: ${result.note}`);
    }

    return { success: true, paid: result.paid, sessionId: result.sessionId };
  }

  private verifyAuth(authHeader?: string): boolean {
    if (!this.webhookSecret) return false;
    return authHeader === `Apikey ${this.webhookSecret}`;
  }

  /** Bóc mã đơn (HD......) khỏi nội dung chuyển khoản (đã chuẩn hóa). */
  private extractOrderCode(content: string): string | null {
    const normalized = content.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const m = normalized.match(/HD[0-9A-Z]{6,14}/);
    return m ? m[0] : null;
  }
}