// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/options.controller.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CreateOptionDto } from './dto/create-option.dto';
import { SetProductOptionsDto } from './dto/set-product-options.dto';
import { UpdateOptionDto } from './dto/update-option.dto';
import { OptionsService } from './options.service';

/** Quản lý topping/tùy chọn + gán cho món. Dùng cho trang admin POS. */
@Controller('options')
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  /** GET /api/options — tất cả topping (kể cả đã ẩn). */
  @Get()
  list() {
    return this.options.list();
  }

  /** POST /api/options — tạo topping. */
  @Post()
  create(@Body() dto: CreateOptionDto) {
    return this.options.create(dto);
  }

  /** PATCH /api/options/:id — sửa topping. */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOptionDto) {
    return this.options.update(id, dto);
  }

  /** DELETE /api/options/:id — ẩn topping (soft delete). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.options.deactivate(id);
  }

  /** PATCH /api/options/:id/restore — hiện lại topping. */
  @Patch(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.options.reactivate(id);
  }

  /** GET /api/options/product/:productId — id topping đang gán cho món. */
  @Get('product/:productId')
  forProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.options.getProductOptionIds(productId);
  }

  /** PUT /api/options/product/:productId — đặt lại topping cho món. */
  @Put('product/:productId')
  setForProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetProductOptionsDto,
  ) {
    return this.options.setProductOptions(productId, dto.optionIds);
  }
}