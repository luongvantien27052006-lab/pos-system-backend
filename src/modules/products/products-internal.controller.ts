// ============================================================
//  APP BACKEND
//  src/modules/products/products-internal.controller.ts  (FILE MOI)
//  Noi bo — POS quan ly TRAI CAY qua proxy (x-internal-secret).
//  Route that: /api/internal/products
//  Dung chung ProductsService (da ho tro `options`/size).
// ============================================================

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

@Controller('internal/products')
export class ProductsInternalController {
  constructor(private readonly productsService: ProductsService) {}

  private guard(secret?: string) {
    if (secret !== process.env.INTERNAL_SYNC_SECRET) {
      throw new ForbiddenException('Sai secret nội bộ');
    }
  }

  /** GET /api/internal/products?category=... — danh sách (cả món đã ẩn). */
  @Public()
  @Get()
  list(@Headers('x-internal-secret') s: string, @Query() q: QueryProductsDto) {
    this.guard(s);
    return this.productsService.findAllForAdmin(q);
  }

  /** POST /api/internal/products — tạo món (kèm options/size). */
  @Public()
  @Post()
  create(
    @Headers('x-internal-secret') s: string,
    @Body() dto: CreateProductDto,
  ) {
    this.guard(s);
    return this.productsService.create(dto);
  }

  /** PATCH /api/internal/products/:id — sửa món (kèm options/size). */
  @Public()
  @Patch(':id')
  update(
    @Headers('x-internal-secret') s: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    this.guard(s);
    return this.productsService.update(id, dto);
  }

  /** DELETE /api/internal/products/:id — xoá món. */
  @Public()
  @Delete(':id')
  async remove(
    @Headers('x-internal-secret') s: string,
    @Param('id') id: string,
  ) {
    this.guard(s);
    await this.productsService.remove(id);
    return { ok: true, id };
  }
}