import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RevenueUpdatedPayload } from '../realtime/realtime.events';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly timezone: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeGateway,
    config: ConfigService,
  ) {
    this.timezone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Ho_Chi_Minh';
  }

  /**
   * Doanh thu HÔM NAY (theo giờ VN): tổng, tiền mặt, chuyển khoản.
   * Chỉ quét đơn PAID trong khoảng [nửa đêm hôm nay, nửa đêm mai) -> bám đúng
   * partial index idx_sessions_revenue (Phần 1) nên chạy gần như tức thời.
   */
  async getTodayRevenue(): Promise<RevenueUpdatedPayload> {
    const row = await this.db.queryOne<{
      date: string;
      total: string;
      cash: string;
      transfer: string;
    }>(
      `WITH bounds AS (
         SELECT date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS day_start
       )
       SELECT
         to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(s.total_amount), 0) AS total,
         COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'CASH'), 0) AS cash,
         COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'BANK_TRANSFER'), 0) AS transfer
       FROM order_sessions s, bounds b
       WHERE s.status = 'PAID'
         AND s.completed_at >= b.day_start
         AND s.completed_at <  b.day_start + INTERVAL '1 day'`,
      [this.timezone],
    );

    return {
      date: row?.date ?? '',
      total: Number(row?.total ?? 0),
      totalCash: Number(row?.cash ?? 0),
      totalTransfer: Number(row?.transfer ?? 0),
    };
  }

  /**
   * Tính lại doanh thu hôm nay & đẩy tới room admin (Socket.io).
   * Gọi mỗi khi có đơn chuyển sang PAID. Tự nuốt lỗi để không chặn luồng thanh toán.
   */
  async broadcastTodayRevenue(): Promise<void> {
    try {
      const revenue = await this.getTodayRevenue();
      this.realtime.emitRevenueUpdated(revenue);
    } catch (e) {
      this.logger.error('Không tính/đẩy được doanh thu real-time', e as Error);
    }
  }
}