import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  /** Thống kê trong [days] ngày gần nhất (quầy PAID + app DELIVERED). */
  async summary(days: number) {
    const d = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
    const p = [String(d)];

    // 1) Xu hướng doanh thu theo ngày
    const revenueTrend = await this.db.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS date,
              SUM(amount)::bigint AS revenue,
              SUM(cnt)::int AS orders
         FROM (
           SELECT DATE(completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
                  total_amount::numeric AS amount, 1 AS cnt
             FROM order_sessions
            WHERE status = 'PAID'
              AND completed_at >= NOW() - ($1 || ' days')::interval
           UNION ALL
           SELECT DATE(received_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
                  total_amount::numeric AS amount, 1 AS cnt
             FROM app_orders
            WHERE prep_status = 'DELIVERED'
              AND received_at >= NOW() - ($1 || ' days')::interval
         ) t
        GROUP BY day ORDER BY day`,
      p,
    );

    // 2) Giờ cao điểm (0-23) — số đơn theo giờ
    const peakHours = await this.db.query(
      `SELECT hour, SUM(cnt)::int AS orders FROM (
         SELECT EXTRACT(HOUR FROM completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour, 1 AS cnt
           FROM order_sessions
          WHERE status = 'PAID' AND completed_at >= NOW() - ($1 || ' days')::interval
         UNION ALL
         SELECT EXTRACT(HOUR FROM received_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour, 1 AS cnt
           FROM app_orders
          WHERE prep_status = 'DELIVERED' AND received_at >= NOW() - ($1 || ' days')::interval
       ) t GROUP BY hour ORDER BY hour`,
      p,
    );

    // 3) Món bán chạy (top 10) — quầy (order_items) + app (jsonb items)
    const bestSellers = await this.db.query(
      `SELECT name, SUM(qty)::int AS qty FROM (
         SELECT oi.name_snapshot AS name, oi.quantity AS qty
           FROM order_items oi JOIN order_sessions s ON s.id = oi.session_id
          WHERE s.status = 'PAID' AND s.completed_at >= NOW() - ($1 || ' days')::interval
         UNION ALL
         SELECT elem->>'name' AS name,
                COALESCE((elem->>'quantity')::numeric, 1) AS qty
           FROM app_orders a, jsonb_array_elements(a.items) elem
          WHERE a.prep_status = 'DELIVERED' AND a.received_at >= NOW() - ($1 || ' days')::interval
       ) t
       WHERE name IS NOT NULL AND name <> ''
       GROUP BY name ORDER BY qty DESC LIMIT 10`,
      p,
    );

    // 4) Tổng
    const totals = await this.db.query(
      `SELECT COALESCE(SUM(amount),0)::bigint AS revenue, COUNT(*)::int AS orders FROM (
         SELECT total_amount::numeric AS amount FROM order_sessions
          WHERE status='PAID' AND completed_at >= NOW() - ($1 || ' days')::interval
         UNION ALL
         SELECT total_amount::numeric AS amount FROM app_orders
          WHERE prep_status='DELIVERED' AND received_at >= NOW() - ($1 || ' days')::interval
       ) t`,
      p,
    );

    const rev = Number(totals[0]?.revenue ?? 0);
    const ord = Number(totals[0]?.orders ?? 0);
    return {
      days: d,
      totalRevenue: rev,
      totalOrders: ord,
      avgOrder: ord > 0 ? Math.round(rev / ord) : 0,
      revenueTrend: revenueTrend.map((r: any) => ({
        date: r.date,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      peakHours: peakHours.map((r: any) => ({
        hour: Number(r.hour),
        orders: Number(r.orders),
      })),
      bestSellers: bestSellers.map((r: any) => ({
        name: r.name,
        qty: Number(r.qty),
      })),
    };
  }
}