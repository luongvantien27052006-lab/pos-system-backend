// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/store/store.controller.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

interface UpdateHoursBody {
  openTime?: string;
  closeTime?: string;
  override?: 'open' | 'closed' | 'auto';
}

/**
 * Proxy cho POS admin chỉnh giờ mở/đóng cửa của App (qua mạng nội bộ).
 * Route: /api/store/hours
 */
@Controller('store')
export class StoreController {
  /** Lấy cấu hình + trạng thái hiện tại. */
  @Get('hours')
  get() {
    return this.callApp('GET');
  }

  /** Cập nhật giờ mở/đóng hoặc ép mở/đóng. */
  @Put('hours')
  update(@Body() body: UpdateHoursBody) {
    return this.callApp('PUT', body);
  }

  private async callApp(method: 'GET' | 'PUT', body?: unknown): Promise<unknown> {
    if (!APP_URL) {
      throw new HttpException('Chưa cấu hình APP_INTERNAL_URL', 500);
    }
    const res = await fetch(`${APP_URL}/internal/store/settings`, {
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