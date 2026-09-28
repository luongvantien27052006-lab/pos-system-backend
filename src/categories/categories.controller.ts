// POS BACKEND  src/categories/categories.controller.ts  (FILE MỚI)
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
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** GET /api/categories — danh sách (kể cả ẩn) cho trang quản trị. */
  @Get()
  list() {
    return this.categories.list();
  }

  /** POST /api/categories — thêm danh mục. */
  @Post()
  create(@Body() b: { name: string; displayOrder?: number }) {
    return this.categories.create(b?.name, b?.displayOrder);
  }

  /** PATCH /api/categories/:id — đổi tên / thứ tự / ẩn-hiện. */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { name?: string; displayOrder?: number; isActive?: boolean },
  ) {
    return this.categories.update(id, b);
  }

  /** DELETE /api/categories/:id — ẩn danh mục (chặn nếu còn món đang bán). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(id);
  }
}
