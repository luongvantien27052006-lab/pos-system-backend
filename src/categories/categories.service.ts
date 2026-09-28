// POS BACKEND  src/categories/categories.service.ts  (FILE MỚI)
// Quản lý danh mục món (thêm/sửa/đổi thứ tự/ẩn). Bảng: categories.

import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface CatRow {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  productCount?: number;
}

@Injectable()
export class CategoriesService {
  constructor(private readonly db: DatabaseService) {}

  /** Danh sách danh mục (kể cả ẩn) + số món đang bán, cho trang quản trị. */
  async list(): Promise<CatRow[]> {
    return this.db.query<CatRow>(
      `SELECT c.id, c.name, c.display_order AS "displayOrder",
              c.is_active AS "isActive",
              COUNT(p.id) FILTER (WHERE p.is_active = TRUE)::int AS "productCount"
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.display_order, c.name`,
    );
  }

  /** Thêm danh mục mới. Mặc định xếp cuối nếu không truyền display_order. */
  async create(name: string, displayOrder?: number): Promise<CatRow> {
    const nm = (name ?? '').trim();
    if (!nm) throw new BadRequestException('Tên danh mục không được để trống');

    const dup = await this.db.queryOne(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
      [nm],
    );
    if (dup) throw new BadRequestException('Danh mục này đã tồn tại');

    let ord = displayOrder;
    if (ord === undefined || ord === null || Number.isNaN(Number(ord))) {
      const max = await this.db.queryOne<{ m: number }>(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS m FROM categories`,
      );
      ord = Number(max?.m ?? 1);
    }

    const row = await this.db.queryOne<CatRow>(
      `INSERT INTO categories (name, display_order, is_active)
       VALUES ($1, $2, TRUE)
       RETURNING id, name, display_order AS "displayOrder", is_active AS "isActive"`,
      [nm, ord],
    );
    return row!;
  }

  /** Sửa danh mục: đổi tên / thứ tự / ẩn-hiện. */
  async update(
    id: number,
    dto: { name?: string; displayOrder?: number; isActive?: boolean },
  ): Promise<CatRow> {
    const existing = await this.db.queryOne(
      `SELECT id FROM categories WHERE id = $1`,
      [id],
    );
    if (!existing) throw new BadRequestException('Không tìm thấy danh mục');

    if (dto.name !== undefined) {
      const nm = dto.name.trim();
      if (!nm) throw new BadRequestException('Tên danh mục không được để trống');
      const dup = await this.db.queryOne(
        `SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id <> $2`,
        [nm, id],
      );
      if (dup) throw new BadRequestException('Danh mục này đã tồn tại');
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (dto.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(dto.name.trim());
    }
    if (dto.displayOrder !== undefined) {
      sets.push(`display_order = $${i++}`);
      params.push(dto.displayOrder);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active = $${i++}`);
      params.push(dto.isActive);
    }
    if (sets.length === 0) throw new BadRequestException('Không có thay đổi nào');

    params.push(id);
    const row = await this.db.queryOne<CatRow>(
      `UPDATE categories SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, name, display_order AS "displayOrder", is_active AS "isActive"`,
      params,
    );
    return row!;
  }

  /**
   * Xoá = ẩn danh mục (is_active=FALSE). Chặn nếu còn MÓN ĐANG BÁN trong đó
   * (tránh món mất danh mục trên menu). Món đã ngừng bán thì không sao.
   */
  async remove(id: number): Promise<{ ok: true; id: number }> {
    const existing = await this.db.queryOne(
      `SELECT id FROM categories WHERE id = $1`,
      [id],
    );
    if (!existing) throw new BadRequestException('Không tìm thấy danh mục');

    const used = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM products WHERE category_id = $1 AND is_active = TRUE`,
      [id],
    );
    if (Number(used?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Danh mục còn món đang bán — hãy chuyển hoặc ngừng bán các món đó trước khi xoá.',
      );
    }

    await this.db.query(
      `UPDATE categories SET is_active = FALSE WHERE id = $1`,
      [id],
    );
    return { ok: true, id };
  }
}
