// ==================================================================
//  POS BACKEND  (NestJS)
//  src/fruits/fruits.controller.ts  (FILE MOI)
//  Proxy quan ly TRAI CAY sang App backend (x-internal-secret),
//  giong het news/vouchers. Route: /api/fruits/...
//  -> tro toi /internal/products cua App.
// ==================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

@Controller('fruits')
export class FruitsController {
  /** GET /api/fruits — danh sách món trái cây (cả món đã ẩn). */
  @Get()
  list(@Query('category') category?: string, @Query('limit') limit?: string) {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    qs.set('limit', limit ?? '1000');
    return this.callApp('GET', `/internal/products?${qs.toString()}`);
  }

  /** POST /api/fruits — thêm món trái cây. */
  @Post()
  create(@Body() body: unknown) {
    return this.callApp('POST', '/internal/products', body);
  }

  /** PATCH /api/fruits/:id — sửa món trái cây. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.callApp('PATCH', `/internal/products/${id}`, body);
  }

  /** DELETE /api/fruits/:id — xoá món trái cây. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.callApp('DELETE', `/internal/products/${id}`);
  }

  // ─── Gọi App backend qua mạng nội bộ (giống news/vouchers) ───
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
    return res.status === 204 ? { ok: true } : res.json();
  }
}