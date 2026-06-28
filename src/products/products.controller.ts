import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
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
import { CloudinaryService } from './cloudinary.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { productImageMulter, UPLOAD_DIR } from './multer.config';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  private readonly logger = new Logger('Products');
  constructor(
    private readonly products: ProductsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

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

    const imageUrl = await this.resolveImage(file);
    try {
      return await this.products.create(dto, imageUrl);
    } catch (e) {
      await this.removeTemp(file);
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
    const newImageUrl = file ? await this.resolveImage(file) : undefined;
    try {
      return await this.products.update(id, dto, newImageUrl);
    } catch (e) {
      if (file) await this.removeTemp(file);
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

  // ─── Helper ảnh ──────────────────────────────────────────────────────
  /**
   * Có Cloudinary -> đẩy lên Cloudinary, trả URL CDN (vĩnh viễn) + xoá file tạm.
   * Không -> giữ nguyên đường dẫn đĩa /uploads/... như cũ.
   */
  private async resolveImage(file: Express.Multer.File): Promise<string> {
    if (!this.cloudinary.isEnabled()) {
      return `/uploads/${file.filename}`;
    }
    try {
      const url = await this.cloudinary.uploadImage(
        join(UPLOAD_DIR, file.filename),
      );
      await this.removeTemp(file); // đã có URL CDN -> bỏ file tạm trên đĩa
      return url;
    } catch (e) {
      await this.removeTemp(file);
      this.logger.error(
        `Upload Cloudinary lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new BadRequestException(
        'Tải ảnh lên Cloudinary thất bại, vui lòng thử lại',
      );
    }
  }

  private removeTemp(file: Express.Multer.File): Promise<void> {
    return unlink(join(UPLOAD_DIR, file.filename))
      .then(() => undefined)
      .catch(() => undefined);
  }
}