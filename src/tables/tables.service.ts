import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateTableDto } from './dto/create-table.dto';

const COLS = `id, table_number AS "tableNumber", display_name AS "displayName", status, is_active AS "isActive"`;

@Injectable()
export class TablesService {
  constructor(private readonly db: DatabaseService) {}

  /** Toàn bộ bàn (cả bàn đã ngừng dùng) cho trang quản trị. */
  list() {
    return this.db.query(
      `SELECT ${COLS} FROM tables ORDER BY is_active DESC, table_number`,
    );
  }

  async create(dto: CreateTableDto) {
    try {
      return await this.db.queryOne(
        `INSERT INTO tables (table_number, display_name)
         VALUES ($1, $2) RETURNING ${COLS}`,
        [dto.tableNumber, dto.displayName ?? null],
      );
    } catch (e) {
      // Vi phạm UNIQUE(table_number)
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(`Số bàn "${dto.tableNumber}" đã tồn tại`);
      }
      throw e;
    }
  }

  async deactivate(id: number) {
    const row = await this.db.queryOne(
      `UPDATE tables SET is_active = FALSE WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!row) throw new BadRequestException('Không tìm thấy bàn');
    return { ok: true, id };
  }

  async reactivate(id: number) {
    const row = await this.db.queryOne(
      `UPDATE tables SET is_active = TRUE WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!row) throw new BadRequestException('Không tìm thấy bàn');
    return { ok: true, id };
  }
}