import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface IncomingReview {
  productId: string;
  productName?: string | null;
  stars: number;
  comment?: string | null;
  userId?: string | null;
  orderId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}

/** Từ bao nhiêu sao trở xuống là đánh giá XẤU (chỉ quán xem, app không hiện). */
export const NEGATIVE_MAX_STARS = 3;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  constructor(private readonly db: DatabaseService) {}

  private ready = false;
  /** Bổ sung cột cho bảng cũ (chạy 1 lần, an toàn khi chạy lại). */
  private async ensureSchema(): Promise<void> {
    if (this.ready) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        user_id      TEXT,
        product_id   TEXT NOT NULL,
        product_name TEXT,
        stars        INT NOT NULL,
        comment      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, product_id)
      )`);
    await this.db.query(`
      ALTER TABLE product_reviews
        ADD COLUMN IF NOT EXISTS review_no      BIGSERIAL,
        ADD COLUMN IF NOT EXISTS order_id       TEXT,
        ADD COLUMN IF NOT EXISTS customer_name  TEXT,
        ADD COLUMN IF NOT EXISTS customer_phone TEXT,
        ADD COLUMN IF NOT EXISTS handled_at     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS handled_by     TEXT,
        ADD COLUMN IF NOT EXISTS handled_note   TEXT`);
    this.ready = true;
  }

  /** Nhận review từ App (upsert theo user+món). */
  async receiveFromApp(
    p: IncomingReview,
  ): Promise<{ ok: true; applied: boolean }> {
    if (!p?.productId || !p?.stars) return { ok: true, applied: false };
    await this.ensureSchema();
    await this.db.query(
      `INSERT INTO product_reviews
         (user_id, product_id, product_name, stars, comment, created_at,
          order_id, customer_name, customer_phone)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET stars = EXCLUDED.stars,
             comment = EXCLUDED.comment,
             product_name = COALESCE(EXCLUDED.product_name, product_reviews.product_name),
             order_id = COALESCE(EXCLUDED.order_id, product_reviews.order_id),
             customer_name = COALESCE(EXCLUDED.customer_name, product_reviews.customer_name),
             customer_phone = COALESCE(EXCLUDED.customer_phone, product_reviews.customer_phone),
             created_at = NOW(),
             -- Khách sửa thành đánh giá xấu (hoặc viết lại) -> cần xem lại.
             handled_at = CASE WHEN EXCLUDED.stars <= ${NEGATIVE_MAX_STARS}
                               THEN NULL ELSE product_reviews.handled_at END`,
      [
        p.userId ?? null,
        p.productId,
        p.productName ?? null,
        p.stars,
        p.comment ?? null,
        p.orderId ?? null,
        p.customerName ?? null,
        p.customerPhone ?? null,
      ],
    );
    this.logger.log(
      `Nhận review món ${p.productName ?? p.productId}: ${p.stars}★` +
        (p.stars <= NEGATIVE_MAX_STARS ? ' (XẤU — cần quán xem)' : ''),
    );
    return { ok: true, applied: true };
  }

  /** Tổng hợp cho màn POS: điểm TB + số lượt theo món + nhận xét gần đây. */
  async summary() {
    await this.ensureSchema();
    const perProduct = await this.db.query(
      `SELECT product_id AS "productId",
              MAX(product_name) AS "productName",
              ROUND(AVG(stars)::numeric, 2)::float AS "avgStars",
              COUNT(*)::int AS "count"
         FROM product_reviews
        GROUP BY product_id
        ORDER BY "avgStars" DESC, "count" DESC`,
    );
    const recent = await this.db.query(
      `SELECT product_id AS "productId", product_name AS "productName",
              stars, comment, created_at AS "createdAt"
         FROM product_reviews
        ORDER BY created_at DESC
        LIMIT 100`,
    );
    const totals = await this.db.query(
      `SELECT COUNT(*)::int AS "count",
              ROUND(AVG(stars)::numeric, 2)::float AS "avgStars",
              COUNT(*) FILTER (WHERE stars <= ${NEGATIVE_MAX_STARS}
                                 AND handled_at IS NULL)::int AS "openNegative"
         FROM product_reviews`,
    );
    return {
      total: totals[0]?.count ?? 0,
      avgStars: totals[0]?.avgStars ?? 0,
      openNegative: totals[0]?.openNegative ?? 0,
      perProduct,
      recent,
    };
  }

  /** Đánh giá XẤU (<= 3 sao) kèm liên hệ khách. status: open = chưa xử lý. */
  async negative(status: 'open' | 'all' = 'open') {
    await this.ensureSchema();
    return this.db.query(
      `SELECT review_no::text AS "id",
              product_id AS "productId", product_name AS "productName",
              stars, comment,
              customer_name AS "customerName", customer_phone AS "customerPhone",
              order_id AS "orderId",
              UPPER(LEFT(REPLACE(COALESCE(order_id, ''), '-', ''), 8)) AS "orderCode",
              created_at AS "createdAt",
              handled_at AS "handledAt", handled_by AS "handledBy",
              handled_note AS "handledNote"
         FROM product_reviews
        WHERE stars <= ${NEGATIVE_MAX_STARS}
          ${status === 'open' ? 'AND handled_at IS NULL' : ''}
        ORDER BY (handled_at IS NULL) DESC, created_at DESC
        LIMIT 200`,
    );
  }

  /** Số đánh giá xấu chưa xử lý (thanh nhắc trên màn thu ngân). */
  async negativeCount() {
    await this.ensureSchema();
    const r = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM product_reviews
        WHERE stars <= ${NEGATIVE_MAX_STARS} AND handled_at IS NULL`,
    );
    return { open: Number(r[0]?.n ?? 0) };
  }

  /** Đánh dấu đã xử lý (đã gọi khách / đã đền bù...). handled=false -> mở lại. */
  async setHandled(id: string, handled: boolean, by?: string, note?: string) {
    await this.ensureSchema();
    if (!/^\d+$/.test(id ?? '')) throw new NotFoundException('Không tìm thấy');
    const rows = await this.db.query(
      `UPDATE product_reviews
          SET handled_at = ${handled ? 'NOW()' : 'NULL'},
              handled_by = $2,
              handled_note = $3
        WHERE review_no = $1::bigint
      RETURNING review_no`,
      [id, handled ? (by ?? null) : null, handled ? (note?.trim() || null) : null],
    );
    if (rows.length === 0) throw new NotFoundException('Không tìm thấy');
    return { ok: true };
  }
}
