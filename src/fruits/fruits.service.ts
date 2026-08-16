// ==================================================================
//  POS BACKEND  src/fruits/fruits.service.ts  (FILE MOI)
//  Huong A: quan ly TRAI CAY nhu SAN PHAM POS THAT (co size gia rieng),
//  roi enqueue dong bo sang App (giong san pham thuong).
//  - Moi mon: 1 product (gia goc = size S) + gan 3 option size (S/M/L)
//    voi gia override rieng qua product_options.price.
//  - Frontend gui options id 'size_s'/'size_m'/'size_l' -> map sang
//    option size toan cuc theo TEN.
// ==================================================================

import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InventorySyncService } from '../sync/inventory-sync.service';

const FRUIT_CATEGORY = 'Trái cây chấm muối';

// map giua id frontend <-> ten option size trong POS
const NAME_BY_FID: Record<string, string> = {
  size_s: 'S · 400g',
  size_m: 'M · 600g',
  size_l: 'L · 800g',
};
const FID_BY_NAME: Record<string, string> = {
  'S · 400g': 'size_s',
  'M · 600g': 'size_m',
  'L · 800g': 'size_l',
};

interface OptIn {
  id: string;
  name?: string;
  price: number;
  groupName?: string;
}
interface FruitDto {
  name?: string;
  price?: number;
  isAvailable?: boolean;
  options?: OptIn[];
}

@Injectable()
export class FruitsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sync: InventorySyncService,
  ) {}

  private async fruitCategoryId(): Promise<number> {
    const row = await this.db.queryOne<{ id: number }>(
      `SELECT id FROM categories
        WHERE app_category = $1 OR name = $1
        ORDER BY id LIMIT 1`,
      [FRUIT_CATEGORY],
    );
    if (!row) {
      throw new BadRequestException(
        'Chưa có danh mục "Trái cây chấm muối" — hãy chạy migration 05_fruit_sizes.sql.',
      );
    }
    return row.id;
  }

  /** 3 option size toàn cục (id + tên). */
  private sizeOptions(): Promise<{ id: number; name: string }[]> {
    return this.db.query<{ id: number; name: string }>(
      `SELECT id, name FROM options
        WHERE group_name = 'Kích cỡ' AND is_active = TRUE`,
    );
  }

  // ── Danh sách (cho tab quản lý) ──
  async list() {
    const cat = await this.fruitCategoryId();
    const products = await this.db.query<{
      id: number;
      name: string;
      price: string;
      is_available: boolean;
    }>(
      `SELECT id, name, price, is_available
         FROM products
        WHERE category_id = $1 AND is_active = TRUE
        ORDER BY display_order, name`,
      [cat],
    );
    if (!products.length) return { items: [] };

    const ids = products.map((p) => p.id);
    const opts = await this.db.query<{
      product_id: number;
      name: string;
      price: string;
    }>(
      `SELECT po.product_id, o.name, COALESCE(po.price, o.price) AS price
         FROM product_options po
         JOIN options o ON o.id = po.option_id
        WHERE po.product_id = ANY($1::bigint[]) AND o.group_name = 'Kích cỡ'`,
      [ids],
    );
    const byProduct = new Map<number, any[]>();
    for (const o of opts) {
      const arr = byProduct.get(o.product_id) ?? [];
      arr.push({
        id: FID_BY_NAME[o.name] ?? o.name,
        name: o.name,
        price: Number(o.price),
        groupName: 'Kích cỡ',
      });
      byProduct.set(o.product_id, arr);
    }
    return {
      items: products.map((p) => ({
        id: String(p.id),
        name: p.name,
        price: Number(p.price),
        is_available: p.is_available,
        options: byProduct.get(p.id) ?? [],
      })),
    };
  }

  // ── Thêm mới ──
  async create(dto: FruitDto) {
    if (!dto.name || !dto.price) {
      throw new BadRequestException('Thiếu tên hoặc giá món');
    }
    const cat = await this.fruitCategoryId();
    const sizes = await this.sizeOptions();
    const product = await this.db.queryOne<{ id: number }>(
      `INSERT INTO products (category_id, name, price, is_available, display_order)
       VALUES ($1, $2, $3, $4, 100)
       RETURNING id`,
      [cat, dto.name, dto.price, dto.isAvailable ?? true],
    );
    if (!product) throw new BadRequestException('Tạo món thất bại');
    await this.assignSizes(product.id, dto.options ?? [], sizes);
    await this.sync.enqueueProductUpsert(product.id); // -> đẩy sang App
    return { id: String(product.id), ok: true };
  }

  // ── Sửa ──
  async update(id: string, dto: FruitDto) {
    const pid = Number(id);
    const sizes = await this.sizeOptions();
    await this.db.query(
      `UPDATE products SET
         name = COALESCE($2, name),
         price = COALESCE($3, price),
         is_available = COALESCE($4, is_available),
         updated_at = NOW()
       WHERE id = $1`,
      [pid, dto.name ?? null, dto.price ?? null, dto.isAvailable ?? null],
    );
    if (dto.options) await this.assignSizes(pid, dto.options, sizes);
    await this.sync.enqueueProductUpsert(pid);
    return { id, ok: true };
  }

  // ── Xoá (ẩn mềm + báo app ẩn) ──
  async remove(id: string) {
    const pid = Number(id);
    await this.db.query(
      `UPDATE products SET is_active = FALSE, is_available = FALSE, updated_at = NOW()
        WHERE id = $1`,
      [pid],
    );
    // Báo app ẩn món (nếu đã map). Best-effort.
    await this.sync.enqueueAvailability(pid);
    return { id, ok: true };
  }

  /** Gán lại 3 size cho món với giá override theo payload (map theo tên). */
  private async assignSizes(
    productId: number,
    options: OptIn[],
    sizes: { id: number; name: string }[],
  ) {
    const sizeIds = sizes.map((s) => s.id);
    if (sizeIds.length) {
      await this.db.query(
        `DELETE FROM product_options
          WHERE product_id = $1 AND option_id = ANY($2::bigint[])`,
        [productId, sizeIds],
      );
    }
    const idByName = new Map(sizes.map((s) => [s.name, s.id]));
    for (const opt of options) {
      const name = NAME_BY_FID[opt.id] ?? opt.name ?? '';
      const optId = idByName.get(name);
      if (optId != null) {
        await this.db.query(
          `INSERT INTO product_options (product_id, option_id, price)
           VALUES ($1, $2, $3)`,
          [productId, optId, opt.price],
        );
      }
    }
  }
}