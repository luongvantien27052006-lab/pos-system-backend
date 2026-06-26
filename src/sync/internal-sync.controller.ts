// =============================================================================
//  REPO 1 (POS) · src/sync/internal-sync.controller.ts
//  Endpoint nội bộ — CHỈ gọi qua private network, xác thực bằng secret (không CORS,
//  không JWT người dùng). Route thật: /api/internal/...  (vì có global prefix 'api').
// =============================================================================
import { Body, Controller, ForbiddenException, Get, Headers, Post } from '@nestjs/common';
import { InventorySyncService } from './inventory-sync.service';

@Controller('internal')
export class InternalSyncController {
  constructor(private readonly sync: InventorySyncService) {}

  private guard(secret?: string) {
    if (secret !== process.env.INTERNAL_SYNC_SECRET) throw new ForbiddenException('Sai secret nội bộ');
  }

  /** App gọi sang để kiểm tra private networking. GET /api/internal/ping */
  @Get('ping')
  ping(@Headers('x-internal-secret') s?: string) {
    this.guard(s);
    return { ok: true, service: 'pos', at: new Date().toISOString() };
  }

  /** POS chủ động ping App (test 2 chiều). GET /api/internal/ping-app */
  @Get('ping-app')
  async pingApp(@Headers('x-internal-secret') s?: string) {
    this.guard(s);
    const app = await this.sync.pingApp();
    return { ok: true, from: 'pos', appReplied: app };
  }

  // (BƯỚC ĐƠN HÀNG — làm sau)
  // POST /api/internal/orders/incoming — nhận đơn từ App, tạo phiên POS + in bếp.
  // @Post('orders/incoming')
  // async incoming(@Headers('x-internal-secret') s: string, @Body() raw: unknown) { ... }
}