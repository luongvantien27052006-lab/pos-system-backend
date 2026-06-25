import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { productImageMulter, UPLOAD_DIR } from './multer.config';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** GET /api/products — danh sách cho trang quản trị. */
  @Get()
  list() {
    return this.products.list();
  }

  /** POST /api/products — tạo món mới kèm ảnh (multipart/form-data, field 'image'). */
  @Post()
  @UseInterceptors(FileInterceptor('image', productImageMulter))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateProductDto,
  ) {
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh món ăn');

    const imageUrl = `/uploads/${file.filename}`;
    try {
      return await this.products.create(dto, imageUrl);
    } catch (e) {
      // Lưu DB thất bại -> xoá file vừa upload để không để rác trên đĩa
      await unlink(join(UPLOAD_DIR, file.filename)).catch(() => undefined);
      throw e;
    }
  }

  /** PATCH /api/products/:id — sửa món; ảnh là tùy chọn (field 'image'). */
  @Patch(':id')
  @UseInterceptors(FileInterceptor('image', productImageMulter))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpdateProductDto,
  ) {
    const newImageUrl = file ? `/uploads/${file.filename}` : undefined;
    try {
      return await this.products.update(id, dto, newImageUrl);
    } catch (e) {
      if (file) {
        await unlink(join(UPLOAD_DIR, file.filename)).catch(() => undefined);
      }
      throw e;
    }
  }

  /** PATCH /api/products/:id/restore — mở bán lại. */
  @Patch(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.products.reactivate(id);
  }

  /** DELETE /api/products/:id — ngừng bán (soft delete). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.products.deactivate(id);
  }
}