// ============================================================
//  POS BACKEND  src/vouchers/vouchers.controller.ts
//  >> FILE MOI (proxy voucher sang App)
// ============================================================

// ==================================================================
//  POS BACKEND — Proxy quản lý Voucher sang App backend
//  (x-internal-secret). Route: /api/vouchers/...
// ==================================================================
import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
} from '@nestjs/common';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

@Controller('vouchers')
export class VouchersController {
  /** GET /api/vouchers — danh sách voucher (cho trang quản trị POS). */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (limit) qs.set('limit', limit);
    if (offset) qs.set('offset', offset);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.callApp('GET', `/internal/vouchers${suffix}`);
  }

  /** POST /api/vouchers — tạo voucher mới. */
  @Post()
  create(@Body() body: unknown) {
    return this.callApp('POST', '/internal/vouchers', body);
  }

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
}