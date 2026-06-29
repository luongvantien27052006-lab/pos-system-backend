// ================================================================
//  POS BACKEND
//  src/sync/inventory-sync.service.ts
//  >> CHEP DE (thay file co san)
// ================================================================

// =============================================================================
//  REPO 1 (POS) · src/sync/inventory-sync.service.ts
//  Worker outbox duy nhất: đẩy menu/kho VÀ trạng thái đơn online sang App.
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
// ví dụ: http://app-backend.railway.internal:8080/api  (NHỚ kèm /api)
const POS_PUBLIC_URL = (process.env.POS_PUBLIC_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

interface SyncRow {
  id: number;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  displayOrder: number;
  appCategory: string | null;
  categoryName: string;
  appProductId: string | null;
}

@Injectable()
export class InventorySyncService {
  private readonly log = new Logger('InventorySync');
  constructor(private readonly db: DatabaseService) {}

  // ── enqueue (gọi từ ProductsService) ──
  async enqueueProductUpsert(productId: number): Promise<void> {
    await this.db.query(
      `INSERT INTO sync_outbox (event_type, payload) VALUES ('product.upsert', $1)`,
      [JSON.stringify({ productId })],
    );
  }
  async enqueueAvailability(productId: number): Promise<void> {
    await this.db.query(
      `INSERT INTO sync_outbox (event_type, payload) VALUES ('availability', $1)`,
      [JSON.stringify({ productId })],
    );
  }

  // ── Worker: đẩy các event PENDING, retry + backoff ──
  async drainOutbox(): Promise<void> {
    const events = await this.db.query<{
      id: number; event_id: string; event_type: string; payload: any; attempts: number;
    }>(
      `SELECT id, event_id, event_type, payload, attempts
         FROM sync_outbox
        WHERE status = 'PENDING' AND next_retry_at <= NOW()
        ORDER BY id LIMIT 20`,
    );
    for (const ev of events) {
      try {
        if (ev.event_type === 'product.upsert') {
          await this.pushProduct(ev.payload.productId, ev.event_id);
        } else if (ev.event_type === 'availability') {
          await this.pushAvailability(ev.payload.productId, ev.event_id);
        } else if (ev.event_type === 'app_order.status') {
          await this.pushOrderStatus(ev.payload.appOrderId, ev.payload.status, ev.event_id);
        }
        await this.db.query(`UPDATE sync_outbox SET status = 'DONE' WHERE id = $1`, [ev.id]);
      } catch (e) {
        const err = e as any;
        const reason = err?.cause?.code || err?.cause?.message || err?.message || String(e);
        const attempts = ev.attempts + 1;
        const backoff = Math.min(2 ** attempts, 300);
        await this.db.query(
          `UPDATE sync_outbox
              SET attempts = $2,
                  next_retry_at = NOW() + ($3 || ' seconds')::interval,
                  status = CASE WHEN $2 >= 12 THEN 'FAILED' ELSE 'PENDING' END
            WHERE id = $1`,
          [ev.id, attempts, backoff],
        );
        this.log.warn(`Đẩy ${ev.event_type} lỗi (lần ${attempts}): ${reason}`);
      }
    }
  }

  // ── Helpers ──
  private absImage(rel: string | null): string | undefined {
    if (!rel) return undefined;
    if (/^https?:\/\//.test(rel)) return rel;
    return POS_PUBLIC_URL + rel;
  }

  private async callApp(path: string, body: unknown): Promise<any> {
    const res = await fetch(APP_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private loadRow(productId: number): Promise<SyncRow | null> {
    return this.db.queryOne<SyncRow>(
      `SELECT p.id, p.name, p.description, p.price,
              p.image_url       AS "imageUrl",
              p.is_available    AS "isAvailable",
              p.is_active       AS "isActive",
              p.display_order   AS "displayOrder",
              c.app_category    AS "appCategory",
              c.name            AS "categoryName",
              p.app_product_id  AS "appProductId"
         FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE p.id = $1`,
      [productId],
    );
  }

  /** Topping đang hoạt động của 1 món (để đẩy kèm sang App). */
  private async loadOptions(
    productId: number,
  ): Promise<
    { id: string; name: string; price: number; groupName: string | null }[]
  > {
    const rows = await this.db.query<{
      id: number;
      name: string;
      price: string;
      group_name: string | null;
    }>(
      `SELECT o.id, o.name, o.price, o.group_name
         FROM product_options po JOIN options o ON o.id = po.option_id
        WHERE po.product_id = $1 AND o.is_active = TRUE
        ORDER BY o.group_name NULLS FIRST, o.name`,
      [productId],
    );
    return rows.map((o) => ({
      id: String(o.id),
      name: o.name,
      price: Number(o.price),
      groupName: o.group_name,
    }));
  }

  private async pushProduct(productId: number, eventId: string): Promise<void> {
    const r = await this.loadRow(productId);
    if (!r) return;
    const price = Math.round(Number(r.price));
    if (price < 1000) throw new Error(`Giá món #${productId} < 1.000đ — App từ chối`);

    const options = await this.loadOptions(productId);

    const ack = await this.callApp('/internal/menu/upsert', {
      eventId,
      posProductId: String(r.id),
      name: r.name,
      description: r.description || undefined,
      category: r.categoryName,
      price,
      imageUrl: this.absImage(r.imageUrl),
      isAvailable: r.isActive && r.isAvailable,
      displayOrder: r.displayOrder ?? 0,
      options,
    });
    if (ack?.appProductId && !r.appProductId) {
      await this.db.query(`UPDATE products SET app_product_id = $2 WHERE id = $1`, [r.id, ack.appProductId]);
    }
  }

  private async pushAvailability(productId: number, eventId: string): Promise<void> {
    const r = await this.loadRow(productId);
    if (!r) return;
    await this.callApp('/internal/menu/availability', {
      eventId,
      posProductId: String(r.id),
      isAvailable: r.isActive && r.isAvailable,
    });
  }

  // ── Đẩy trạng thái đơn online về App ──
  private async pushOrderStatus(appOrderId: string, status: string, eventId: string): Promise<void> {
    await this.callApp('/internal/orders/status', { eventId, appOrderId, status });
  }

  // ── Test private networking ──
  async pingApp(): Promise<any> {
    const res = await fetch(APP_URL + '/internal/ping', {
      headers: { 'x-internal-secret': SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }
}