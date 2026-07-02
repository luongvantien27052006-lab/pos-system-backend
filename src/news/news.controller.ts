// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/news/news.controller.ts
//  >> FILE MOI (tao moi)
//  Proxy quan ly Tin tuc sang App backend (x-internal-secret) +
//  upload anh tin (tai dung Cloudinary/Multer cua products).
//  Route: /api/news/...
// ==================================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { CloudinaryService } from '../products/cloudinary.service';
import { productImageMulter, UPLOAD_DIR } from '../products/multer.config';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

@Controller('news')
export class NewsController {
  private readonly logger = new Logger('News');
  constructor(private readonly cloudinary: CloudinaryService) {}

  /** GET /api/news — danh sách tin (kể cả tin ẩn) cho trang quản trị. */
  @Get()
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const qs = new URLSearchParams();
    if (limit) qs.set('limit', limit);
    if (offset) qs.set('offset', offset);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.callApp('GET', `/internal/news${suffix}`);
  }

  /** GET /api/news/:id — 1 tin (kể cả tin ẩn). */
  @Get(':id')
  one(@Param('id') id: string) {
    return this.callApp('GET', `/internal/news/${id}`);
  }

  /** POST /api/news — đăng tin mới. */
  @Post()
  create(@Body() body: unknown) {
    return this.callApp('POST', '/internal/news', body);
  }

  /** PATCH /api/news/:id — sửa tin. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.callApp('PATCH', `/internal/news/${id}`, body);
  }

  /** DELETE /api/news/:id — xoá tin. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.callApp('DELETE', `/internal/news/${id}`);
  }

  /** POST /api/news/image — upload ảnh tin (field 'image') -> trả { url }. */
  @Post('image')
  @UseInterceptors(FileInterceptor('image', productImageMulter))
  async uploadImage(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh');
    const url = await this.resolveImage(file);
    return { url };
  }

  // ─── Helper gọi App backend qua mạng nội bộ ─────────────────────────
  private async callApp(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!APP_URL) {
      throw new HttpException('Chưa cấu hình APP_INTERNAL_URL', 500);
    }
    const res = await fetch(`${APP_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new HttpException(await res.text(), res.status);
    }
    return res.json();
  }

  // ─── Helper ảnh (tái dùng logic products) ───────────────────────────
  private async resolveImage(file: Express.Multer.File): Promise<string> {
    if (!this.cloudinary.isEnabled()) {
      return `/uploads/${file.filename}`;
    }
    try {
      const url = await this.cloudinary.uploadImage(
        join(UPLOAD_DIR, file.filename),
      );
      await this.removeTemp(file);
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