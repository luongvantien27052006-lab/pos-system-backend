// =============================================================================
//  REPO 1 (POS) · src/sync/inventory-sync.service.ts
//  Đẩy thực đơn / trạng thái kho sang App F&B qua Railway Private Networking.
//  Khớp với DatabaseService thật (query / queryOne) và schema products của bạn.
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface SyncRow {
  id: number;
  name: string;
  description: string | null;
  price: string; // pg trả NUMERIC dạng chuỗi
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  displayOrder: number;
  appCategory: string | null;
  appProductId: string | null;
}

@Injectable()
export class InventorySyncService {
  private readonly log = new Logger('InventorySync');
  constructor(private readonly db: DatabaseService) {}

  // Chuyển các hằng số môi trường thành Getter bên trong Class để tránh nạp sớm ở máy local
  private get appUrl(): string {
    return (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
  }

  private get posPublicUrl(): string {
    return (process.env.POS_PUBLIC_URL ?? '').replace(/\/+$/, '');
  }

  private get secret(): string {
    return process.env.INTERNAL_SYNC_SECRET ?? '';
  }

  // ── Đưa event vào outbox (gọi từ ProductsService sau mỗi thao tác Admin) ──
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

  // ── Worker: đẩy các event PENDING, retry + backoff nếu lỗi ──
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
        }
        await this.db.query(`UPDATE sync_outbox SET status = 'DONE' WHERE id = $1`, [ev.id]);
      } catch (e) {
        const attempts = ev.attempts + 1;
        const backoff = Math.min(2 ** attempts, 300); // tối đa 5 phút
        await this.db.query(
          `UPDATE sync_outbox
              SET attempts = $2,
                  next_retry_at = NOW() + ($3 || ' seconds')::interval,
                  status = CASE WHEN $2 >= 12 THEN 'FAILED' ELSE 'PENDING' END
            WHERE id = $1`,
          [ev.id, attempts, backoff],
        );
        this.log.warn(`Đẩy ${ev.event_type} #${ev.payload?.productId} lỗi (lần ${attempts}): ${(e as Error).message}`);
      }
    }
  }

  // ── Helpers ──
  private absImage(rel: string | null): string | undefined {
    if (!rel) return undefined;
    if (/^https?:\/\//.test(rel)) return rel;
    return this.posPublicUrl + rel; // Sử dụng getter lười
  }

  private async callApp(path: string, body: unknown): Promise<any> {
    // Ép tạo URL tuyệt đối từ hàm getter tại thời điểm thực thi request
    const targetUrl = this.appUrl + path;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.secret },
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
              p.app_product_id  AS "appProductId"
         FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE p.id = $1`,
      [productId],
    );
  }

  // ── Đẩy 1 món sang App (App: POST /internal/menu/upsert) ──
  private async pushProduct(productId: number, eventId: string): Promise<void> {
    const r = await this.loadRow(productId);
    if (!r) return; // món bị xoá khỏi DB — bỏ qua
    if (!r.appCategory) {
      throw new Error(`Danh mục của món #${productId} chưa gán app_category (COFFEE/MILK_TEA/TEA)`);
    }
    const price = Math.round(Number(r.price));
    if (price < 1000) throw new Error(`Giá món #${productId} < 1.000đ — App từ chối`);

    const ack = await this.callApp('/internal/menu/upsert', {
      eventId,
      posProductId: String(r.id),
      name: r.name,
      description: r.description || undefined,
      category: r.appCategory,
      price,
      imageUrl: this.absImage(r.imageUrl),
      isAvailable: r.isActive && r.isAvailable, // ngừng bán HOẶC hết hàng => ẩn trên app
      displayOrder: r.displayOrder ?? 0,
    });

    if (ack?.appProductId && !r.appProductId) {
      await this.db.query(`UPDATE products SET app_product_id = $2 WHERE id = $1`, [r.id, ack.appProductId]);
    }
  }

  // ── Khóa/mở món real-time (App: POST /internal/menu/availability) ──
  private async pushAvailability(productId: number, eventId: string): Promise<void> {
    const r = await this.loadRow(productId);
    if (!r) return;
    await this.callApp('/internal/menu/availability', {
      eventId,
      posProductId: String(r.id),
      isAvailable: r.isActive && r.isAvailable,
    });
  }

  // ── Test private networking: POS chủ động gọi App ──
  async pingApp(): Promise<any> {
    const res = await fetch(this.appUrl + '/internal/ping', {
      headers: { 'x-internal-secret': this.secret },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }
}