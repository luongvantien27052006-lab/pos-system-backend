import { BadRequestException, Injectable } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UPLOAD_DIR } from './multer.config';

interface ProductRow {
  id: number;
  name: string;
  shortName: string | null;
  price: string; // pg trả NUMERIC dạng chuỗi
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  categoryId: number;
  categoryName?: string;
}

function mapProduct(r: ProductRow) {
  return { ...r, price: Number(r.price) };
}

@Injectable()
export class ProductsService {
  constructor(private readonly db: DatabaseService) {}

  /** Tạo món mới; image_url là đường dẫn file đã lưu (vd: /uploads/xxx.png). */
  async create(dto: CreateProductDto, imageUrl: string) {
    const cat = await this.db.queryOne(
      `SELECT id FROM categories WHERE id = $1 AND is_active = TRUE`,
      [dto.category_id],
    );
    if (!cat) throw new BadRequestException('Danh mục không tồn tại');

    const row = await this.db.queryOne<ProductRow>(
      `INSERT INTO products (category_id, name, price, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category_id AS "categoryId", name, short_name AS "shortName",
                 price, image_url AS "imageUrl",
                 is_available AS "isAvailable", is_active AS "isActive"`,
      [dto.category_id, dto.name, dto.price, imageUrl],
    );
    return mapProduct(row!);
  }

  /** Danh sách toàn bộ món (cả ngừng bán) cho trang quản trị. */
  async list() {
    const rows = await this.db.query<ProductRow>(
      `SELECT p.id, p.name, p.short_name AS "shortName", p.price,
              p.image_url AS "imageUrl",
              p.is_available AS "isAvailable", p.is_active AS "isActive",
              p.category_id AS "categoryId", c.name AS "categoryName"
         FROM products p
         JOIN categories c ON c.id = p.category_id
        ORDER BY p.is_active DESC, c.display_order, p.display_order, p.name`,
    );
    return rows.map(mapProduct);
  }

  /**
   * Sửa món: chỉ cập nhật các trường được gửi lên (UPDATE động).
   * Nếu có ảnh mới -> cập nhật image_url rồi xoá file ảnh cũ (best-effort).
   */
  async update(id: number, dto: UpdateProductDto, newImageUrl?: string) {
    const existing = await this.db.queryOne<{ imageUrl: string | null }>(
      `SELECT image_url AS "imageUrl" FROM products WHERE id = $1`,
      [id],
    );
    if (!existing) throw new BadRequestException('Không tìm thấy món');

    if (dto.category_id !== undefined) {
      const cat = await this.db.queryOne(
        `SELECT id FROM categories WHERE id = $1 AND is_active = TRUE`,
        [dto.category_id],
      );
      if (!cat) throw new BadRequestException('Danh mục không tồn tại');
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (dto.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(dto.name);
    }
    if (dto.price !== undefined) {
      sets.push(`price = $${i++}`);
      params.push(dto.price);
    }
    if (dto.category_id !== undefined) {
      sets.push(`category_id = $${i++}`);
      params.push(dto.category_id);
    }
    if (newImageUrl) {
      sets.push(`image_url = $${i++}`);
      params.push(newImageUrl);
    }

    if (sets.length === 0) {
      throw new BadRequestException('Không có thay đổi nào');
    }

    params.push(id);
    const row = await this.db.queryOne<ProductRow>(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, category_id AS "categoryId", name, short_name AS "shortName",
                 price, image_url AS "imageUrl",
                 is_available AS "isAvailable", is_active AS "isActive"`,
      params,
    );

    // Thay ảnh thành công -> dọn file ảnh cũ nếu là file local
    if (newImageUrl && existing.imageUrl?.startsWith('/uploads/')) {
      const oldName = existing.imageUrl.replace('/uploads/', '');
      await unlink(join(UPLOAD_DIR, oldName)).catch(() => undefined);
    }
    return mapProduct(row!);
  }

  /** Mở bán lại món đã ngừng. */
  async reactivate(id: number) {
    const row = await this.db.queryOne(
      `UPDATE products SET is_active = TRUE WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!row) throw new BadRequestException('Không tìm thấy món');
    return { ok: true, id };
  }

  /**
   * "Xoá" món = ngừng bán (is_active = FALSE). Dùng soft-delete vì products được
   * order_items tham chiếu (ON DELETE RESTRICT) — không xoá cứng để giữ lịch sử đơn.
   */
  async deactivate(id: number) {
    const row = await this.db.queryOne(
      `UPDATE products SET is_active = FALSE WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!row) throw new BadRequestException('Không tìm thấy món');
    return { ok: true, id };
  }
}