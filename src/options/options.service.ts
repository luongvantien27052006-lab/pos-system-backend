// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/options.service.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateOptionDto } from './dto/create-option.dto';
import { UpdateOptionDto } from './dto/update-option.dto';

interface OptionRow {
  id: number;
  name: string;
  price: string;
  group_name: string | null;
  is_active: boolean;
}

export interface OptionView {
  id: number;
  name: string;
  price: number;
  groupName: string | null;
  isActive: boolean;
}

@Injectable()
export class OptionsService {
  constructor(private readonly db: DatabaseService) {}

  /** Tất cả topping (kể cả đã ẩn) cho trang quản trị. */
  async list(): Promise<OptionView[]> {
    const rows = await this.db.query<OptionRow>(
      `SELECT id, name, price, group_name, is_active
         FROM options
        ORDER BY is_active DESC, group_name NULLS FIRST, name`,
    );
    return rows.map((r) => this.toView(r));
  }

  async create(dto: CreateOptionDto): Promise<OptionView> {
    const row = await this.db.queryOne<OptionRow>(
      `INSERT INTO options (name, price, group_name)
       VALUES ($1, $2, $3)
       RETURNING id, name, price, group_name, is_active`,
      [dto.name, dto.price, dto.groupName ?? null],
    );
    return this.toView(row as OptionRow);
  }

  async update(id: number, dto: UpdateOptionDto): Promise<OptionView> {
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
    if (dto.groupName !== undefined) {
      sets.push(`group_name = $${i++}`);
      params.push(dto.groupName);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active = $${i++}`);
      params.push(dto.isActive);
    }
    if (!sets.length) return this.getOne(id);

    params.push(id);
    const row = await this.db.queryOne<OptionRow>(
      `UPDATE options SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, name, price, group_name, is_active`,
      params,
    );
    if (!row) throw new NotFoundException(`Không tìm thấy topping #${id}`);
    return this.toView(row);
  }

  /** Ẩn topping (soft delete) — giữ option_id để không vỡ đơn cũ. */
  deactivate(id: number): Promise<OptionView> {
    return this.update(id, { isActive: false });
  }

  reactivate(id: number): Promise<OptionView> {
    return this.update(id, { isActive: true });
  }

  /** Danh sách id topping đang gán cho 1 món. */
  async getProductOptionIds(productId: number): Promise<number[]> {
    const rows = await this.db.query<{ option_id: number }>(
      `SELECT option_id FROM product_options WHERE product_id = $1`,
      [productId],
    );
    return rows.map((r) => r.option_id);
  }

  /** Đặt lại toàn bộ topping cho 1 món (thay thế). */
  async setProductOptions(
    productId: number,
    optionIds: number[],
  ): Promise<{ productId: number; optionIds: number[] }> {
    const unique = [...new Set(optionIds)];
    await this.db.transaction(async (client) => {
      await client.query(`DELETE FROM product_options WHERE product_id = $1`, [
        productId,
      ]);
      for (const oid of unique) {
        await client.query(
          `INSERT INTO product_options (product_id, option_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [productId, oid],
        );
      }
    });
    return { productId, optionIds: unique };
  }

  private async getOne(id: number): Promise<OptionView> {
    const row = await this.db.queryOne<OptionRow>(
      `SELECT id, name, price, group_name, is_active FROM options WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException(`Không tìm thấy topping #${id}`);
    return this.toView(row);
  }

  private toView(r: OptionRow): OptionView {
    return {
      id: r.id,
      name: r.name,
      price: Number(r.price),
      groupName: r.group_name,
      isActive: r.is_active,
    };
  }
}