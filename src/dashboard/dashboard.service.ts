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

  // =======================================================================
  //  SO SÁNH NHANH (hôm nay vs hôm qua, tháng này vs tháng trước)
  // =======================================================================
  async getRevenueCompare(): Promise<{
    today: number;
    yesterday: number;
    thisMonth: number;
    lastMonth: number;
  }> {
    const tz = this.timezone;
    const row = await this.db.queryOne<{
      today: string;
      yday: string;
      this_month: string;
      last_month: string;
    }>(
      `WITH b AS (
         SELECT
           date_trunc('day',   NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS d0,
           (date_trunc('day',  NOW() AT TIME ZONE $1) - INTERVAL '1 day')   AT TIME ZONE $1 AS d1,
           date_trunc('month', NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS m0,
           (date_trunc('month',NOW() AT TIME ZONE $1) - INTERVAL '1 month') AT TIME ZONE $1 AS m1
       )
       SELECT
         (SELECT COALESCE(SUM(total_amount),0) FROM order_sessions s, b
            WHERE s.status='PAID' AND s.completed_at >= b.d0 AND s.completed_at < b.d0 + INTERVAL '1 day')
       + (SELECT COALESCE(SUM(total_amount),0) FROM app_orders a, b
            WHERE a.payment_status='PAID' AND a.paid_at >= b.d0 AND a.paid_at < b.d0 + INTERVAL '1 day') AS today,
         (SELECT COALESCE(SUM(total_amount),0) FROM order_sessions s, b
            WHERE s.status='PAID' AND s.completed_at >= b.d1 AND s.completed_at < b.d1 + INTERVAL '1 day')
       + (SELECT COALESCE(SUM(total_amount),0) FROM app_orders a, b
            WHERE a.payment_status='PAID' AND a.paid_at >= b.d1 AND a.paid_at < b.d1 + INTERVAL '1 day') AS yday,
         (SELECT COALESCE(SUM(total_amount),0) FROM order_sessions s, b
            WHERE s.status='PAID' AND s.completed_at >= b.m0 AND s.completed_at < b.m0 + INTERVAL '1 month')
       + (SELECT COALESCE(SUM(total_amount),0) FROM app_orders a, b
            WHERE a.payment_status='PAID' AND a.paid_at >= b.m0 AND a.paid_at < b.m0 + INTERVAL '1 month') AS this_month,
         (SELECT COALESCE(SUM(total_amount),0) FROM order_sessions s, b
            WHERE s.status='PAID' AND s.completed_at >= b.m1 AND s.completed_at < b.m1 + INTERVAL '1 month')
       + (SELECT COALESCE(SUM(total_amount),0) FROM app_orders a, b
            WHERE a.payment_status='PAID' AND a.paid_at >= b.m1 AND a.paid_at < b.m1 + INTERVAL '1 month') AS last_month
       FROM b`,
      [tz],
    );
    return {
      today: Number(row?.today ?? 0),
      yesterday: Number(row?.yday ?? 0),
      thisMonth: Number(row?.this_month ?? 0),
      lastMonth: Number(row?.last_month ?? 0),
    };
  }

  // =======================================================================
  //  CHỐT SỔ CUỐI CA — đếm tiền mặt (B3)
  // =======================================================================
  private cashTableReady = false;
  private async ensureCashTable(): Promise<void> {
    if (this.cashTableReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS cash_reconciliations (
        id         SERIAL PRIMARY KEY,
        biz_date   DATE NOT NULL,
        expected   NUMERIC(12,2) NOT NULL DEFAULT 0,
        counted    NUMERIC(12,2) NOT NULL DEFAULT 0,
        difference NUMERIC(12,2) NOT NULL DEFAULT 0,
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    this.cashTableReady = true;
  }

  /** Tiền mặt KỲ VỌNG 1 ngày (VN): tiền mặt quầy + COD app đã thu. */
  async getCashExpected(
    date?: string,
  ): Promise<{ date: string; expected: number }> {
    const row = await this.db.queryOne<{ d: string; c: string }>(
      `WITH b AS (
         SELECT COALESCE($2::date, (NOW() AT TIME ZONE $1)::date) AS bd
       ), bb AS (
         SELECT bd,
                (bd::timestamp AT TIME ZONE $1)        AS start_ts,
                ((bd + 1)::timestamp AT TIME ZONE $1)  AS end_ts
         FROM b
       )
       SELECT to_char(bb.bd,'YYYY-MM-DD') AS d,
         COALESCE((SELECT SUM(total_amount) FROM order_sessions s, bb
                    WHERE s.status='PAID' AND s.payment_method='CASH'
                      AND s.completed_at >= bb.start_ts AND s.completed_at < bb.end_ts),0)
       + COALESCE((SELECT SUM(total_amount) FROM app_orders a, bb
                    WHERE a.payment_status='PAID' AND a.payment_method='COD'
                      AND a.paid_at >= bb.start_ts AND a.paid_at < bb.end_ts),0) AS c
       FROM bb`,
      [this.timezone, date ?? null],
    );
    return { date: row?.d ?? '', expected: Number(row?.c ?? 0) };
  }

  async saveCashReconcile(
    date: string | undefined,
    counted: number,
    note?: string,
  ) {
    await this.ensureCashTable();
    const { date: bd, expected } = await this.getCashExpected(date);
    const difference = Math.round((counted - expected) * 100) / 100;
    const row = await this.db.queryOne(
      `INSERT INTO cash_reconciliations (biz_date, expected, counted, difference, note)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, to_char(biz_date,'YYYY-MM-DD') AS biz_date,
                 expected, counted, difference, note, created_at`,
      [bd, expected, counted, difference, note ?? null],
    );
    if (!row) throw new Error('Không lưu được chốt sổ');
    return this.mapReconcile(row);
  }

  async listCashReconciles(limit = 30) {
    await this.ensureCashTable();
    const rows = await this.db.query(
      `SELECT id, to_char(biz_date,'YYYY-MM-DD') AS biz_date,
              expected, counted, difference, note, created_at
         FROM cash_reconciliations ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.mapReconcile(r));
  }

  private mapReconcile(r: Record<string, unknown>) {
    return {
      id: Number(r.id),
      date: r.biz_date as string,
      expected: Number(r.expected),
      counted: Number(r.counted),
      difference: Number(r.difference),
      note: (r.note as string) ?? null,
      createdAt: r.created_at as Date,
    };
  }
}