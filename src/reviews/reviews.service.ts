import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface IncomingReview {
  productId: string;
  productName?: string | null;
  stars: number;
  comment?: string | null;
  userId?: string | null;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  constructor(private readonly db: DatabaseService) {}

  /** Nhận review từ App (upsert theo user+món). */
  async receiveFromApp(
    p: IncomingReview,
  ): Promise<{ ok: true; applied: boolean }> {
    if (!p?.productId || !p?.stars) return { ok: true, applied: false };
    await this.db.query(
      `INSERT INTO product_reviews
         (user_id, product_id, product_name, stars, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET stars = EXCLUDED.stars,
             comment = EXCLUDED.comment,
             product_name = COALESCE(EXCLUDED.product_name, product_reviews.product_name),
             created_at = NOW()`,
      [
        p.userId ?? null,
        p.productId,
        p.productName ?? null,
        p.stars,
        p.comment ?? null,
      ],
    );
    this.logger.log(`Nhận review món ${p.productName ?? p.productId}: ${p.stars}★`);
    return { ok: true, applied: true };
  }

  /** Tổng hợp cho màn POS: điểm TB + số lượt theo món + nhận xét gần đây. */
  async summary() {
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
              ROUND(AVG(stars)::numeric, 2)::float AS "avgStars"
         FROM product_reviews`,
    );
    return {
      total: totals[0]?.count ?? 0,
      avgStars: totals[0]?.avgStars ?? 0,
      perProduct,
      recent,
    };
  }
}