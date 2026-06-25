import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateTableDto } from './dto/create-table.dto';
import { TablesService } from './tables.service';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /** GET /api/tables/admin — danh sách đầy đủ cho trang quản trị
   *  (không trùng với GET /api/tables của CatalogController — chỉ trả bàn đang dùng). */
  @Get('admin')
  listAll() {
    return this.tables.list();
  }

  /** POST /api/tables — thêm bàn mới. */
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto);
  }

  /** PATCH /api/tables/:id/restore — bật lại bàn đã ngừng dùng. */
  @Patch(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.tables.reactivate(id);
  }

  /** DELETE /api/tables/:id — ngừng dùng (soft delete). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tables.deactivate(id);
  }
}