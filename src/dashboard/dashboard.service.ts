// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/dashboard/dashboard.service.ts
//  >> CHEP DE (thay file co san)
// ==================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RevenueUpdatedPayload } from '../realtime/realtime.events';

/** Doanh thu tổng hợp theo tháng (gộp đơn quầy + đơn online). */
export interface MonthlyRevenue {
  /** Tháng theo giờ VN, dạng YYYY-MM. */
  month: string;
  total: number;
  totalCash: number;
  totalTransfer: number;
  /** Phần doanh thu đến từ đơn online (App). Đã gộp sẵn vào `total`. */
  appTotal: number;
  /** Tổng số đơn PAID trong tháng (quầy + online). */
  orderCount: number;
}

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
      s_total: string;
      s_cash: string;
      s_transfer: string;
      a_total: string;
      a_cash: string;
      a_transfer: string;
    }>(
      `WITH bounds AS (
         SELECT date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS day_start
       )
       SELECT
         to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS date,
         -- Đơn tại quầy/bàn (order_sessions)
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID'
                      AND s.completed_at >= b.day_start
                      AND s.completed_at <  b.day_start + INTERVAL '1 day'), 0) AS s_total,
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID' AND s.payment_method = 'CASH'
                      AND s.completed_at >= b.day_start
                      AND s.completed_at <  b.day_start + INTERVAL '1 day'), 0) AS s_cash,
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID' AND s.payment_method = 'BANK_TRANSFER'
                      AND s.completed_at >= b.day_start
                      AND s.completed_at <  b.day_start + INTERVAL '1 day'), 0) AS s_transfer,
         -- Đơn online (app_orders) — COD tính tiền mặt, BANK_QR tính chuyển khoản
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID'
                      AND a.paid_at >= b.day_start
                      AND a.paid_at <  b.day_start + INTERVAL '1 day'), 0) AS a_total,
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID' AND a.payment_method = 'COD'
                      AND a.paid_at >= b.day_start
                      AND a.paid_at <  b.day_start + INTERVAL '1 day'), 0) AS a_cash,
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID' AND a.payment_method = 'BANK_QR'
                      AND a.paid_at >= b.day_start
                      AND a.paid_at <  b.day_start + INTERVAL '1 day'), 0) AS a_transfer`,
      [this.timezone],
    );

    const sTotal = Number(row?.s_total ?? 0);
    const sCash = Number(row?.s_cash ?? 0);
    const sTransfer = Number(row?.s_transfer ?? 0);
    const aTotal = Number(row?.a_total ?? 0);
    const aCash = Number(row?.a_cash ?? 0);
    const aTransfer = Number(row?.a_transfer ?? 0);

    return {
      date: row?.date ?? '',
      total: sTotal + aTotal,
      totalCash: sCash + aCash,
      totalTransfer: sTransfer + aTransfer,
      appTotal: aTotal,
    };
  }

  /**
   * Doanh thu THÁNG NÀY (theo giờ VN): từ ngày 1 đầu tháng đến hiện tại.
   * Gộp đơn tại quầy (order_sessions, completed_at) + đơn online
   * (app_orders, paid_at). COD -> tiền mặt, BANK_QR -> chuyển khoản.
   */
  async getMonthlyRevenue(): Promise<MonthlyRevenue> {
    const row = await this.db.queryOne<{
      month: string;
      s_total: string;
      s_cash: string;
      s_transfer: string;
      s_count: string;
      a_total: string;
      a_cash: string;
      a_transfer: string;
      a_count: string;
    }>(
      `WITH bounds AS (
         SELECT date_trunc('month', NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS m_start
       )
       SELECT
         to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM') AS month,
         -- Đơn tại quầy/bàn
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID'
                      AND s.completed_at >= b.m_start
                      AND s.completed_at <  b.m_start + INTERVAL '1 month'), 0) AS s_total,
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID' AND s.payment_method = 'CASH'
                      AND s.completed_at >= b.m_start
                      AND s.completed_at <  b.m_start + INTERVAL '1 month'), 0) AS s_cash,
         COALESCE((SELECT SUM(s.total_amount) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID' AND s.payment_method = 'BANK_TRANSFER'
                      AND s.completed_at >= b.m_start
                      AND s.completed_at <  b.m_start + INTERVAL '1 month'), 0) AS s_transfer,
         COALESCE((SELECT COUNT(*) FROM order_sessions s, bounds b
                    WHERE s.status = 'PAID'
                      AND s.completed_at >= b.m_start
                      AND s.completed_at <  b.m_start + INTERVAL '1 month'), 0) AS s_count,
         -- Đơn online (app_orders)
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID'
                      AND a.paid_at >= b.m_start
                      AND a.paid_at <  b.m_start + INTERVAL '1 month'), 0) AS a_total,
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID' AND a.payment_method = 'COD'
                      AND a.paid_at >= b.m_start
                      AND a.paid_at <  b.m_start + INTERVAL '1 month'), 0) AS a_cash,
         COALESCE((SELECT SUM(a.total_amount) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID' AND a.payment_method = 'BANK_QR'
                      AND a.paid_at >= b.m_start
                      AND a.paid_at <  b.m_start + INTERVAL '1 month'), 0) AS a_transfer,
         COALESCE((SELECT COUNT(*) FROM app_orders a, bounds b
                    WHERE a.payment_status = 'PAID'
                      AND a.paid_at >= b.m_start
                      AND a.paid_at <  b.m_start + INTERVAL '1 month'), 0) AS a_count`,
      [this.timezone],
    );

    const sTotal = Number(row?.s_total ?? 0);
    const sCash = Number(row?.s_cash ?? 0);
    const sTransfer = Number(row?.s_transfer ?? 0);
    const sCount = Number(row?.s_count ?? 0);
    const aTotal = Number(row?.a_total ?? 0);
    const aCash = Number(row?.a_cash ?? 0);
    const aTransfer = Number(row?.a_transfer ?? 0);
    const aCount = Number(row?.a_count ?? 0);

    return {
      month: row?.month ?? '',
      total: sTotal + aTotal,
      totalCash: sCash + aCash,
      totalTransfer: sTransfer + aTransfer,
      appTotal: aTotal,
      orderCount: sCount + aCount,
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