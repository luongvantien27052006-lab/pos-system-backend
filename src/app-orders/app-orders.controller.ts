import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AppOrdersService } from './app-orders.service';
import { ReceiveAppOrderDto } from './dto/receive-app-order.dto';
import { UpdatePrepStatusDto } from './dto/update-prep-status.dto';

/**
 * NỘI BỘ — App gọi sang qua private network. Route thật: /api/internal/orders/...
 * Chặn bằng secret nội bộ (không CORS, không JWT người dùng).
 */
@Controller('internal/orders')
export class AppOrdersInternalController {
  constructor(private readonly service: AppOrdersService) {}

  private guard(secret?: string) {
    if (secret !== process.env.INTERNAL_SYNC_SECRET) {
      throw new ForbiddenException('Sai secret nội bộ');
    }
  }

  /** App đẩy đơn mới sang. */
  @Post('incoming')
  receive(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: ReceiveAppOrderDto,
  ) {
    this.guard(secret);
    return this.service.receiveFromApp(dto);
  }

  /** App báo khách đã HỦY đơn -> POS cảnh báo thu ngân. Body: { appOrderId }. */
  @Post('cancel')
  cancel(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: { appOrderId?: string },
  ) {
    this.guard(secret);
    if (!body?.appOrderId) {
      return { ok: true, applied: false };
    }
    return this.service.cancelFromApp(body.appOrderId);
  }

  /** App báo khách ĐÃ NHẬN HÀNG -> POS đánh dấu đã giao. Body: { appOrderId }. */
  @Post('received')
  received(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: { appOrderId?: string },
  ) {
    this.guard(secret);
    if (!body?.appOrderId) {
      return { ok: true, applied: false };
    }
    return this.service.markReceivedFromApp(body.appOrderId);
  }
}

/**
 * CHO MÀN THU NGÂN (frontend POS gọi). Route thật: /api/app-orders/...
 * Cùng tầng bảo vệ với các endpoint POS khác (PIN cookie ở frontend middleware).
 */
@Controller('app-orders')
export class AppOrdersController {
  constructor(private readonly service: AppOrdersService) {}

  /** Danh sách đơn online đang cần xử lý (render + đồng bộ lại khi reconnect). */
  @Get('active')
  active() {
    return this.service.listActive();
  }

  /**
   * Đơn HẸN GIỜ sắp tới (App đang giữ, chưa đẩy bếp) — thu ngân xem trước.
   * Đến giờ hẹn trừ 20 phút, App tự đẩy đơn sang như đơn thường.
   */
  @Get('scheduled')
  async scheduled(): Promise<unknown> {
    const base = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
    const res = await fetch(base + '/internal/orders/scheduled-upcoming', {
      headers: { 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET ?? '' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Đổi trạng thái chế biến: CONFIRMED -> IN_PROGRESS -> READY -> DELIVERED. */
  @Patch(':appOrderId/status')
  updateStatus(
    @Param('appOrderId') appOrderId: string,
    @Body() dto: UpdatePrepStatusDto,
  ) {
    return this.service.updateStatus(appOrderId, dto.status);
  }

  /** Xác nhận đã thu tiền (COD sau khi giao) -> ghi nhận doanh thu. */
  @Patch(':appOrderId/payment')
  confirmPayment(@Param('appOrderId') appOrderId: string) {
    return this.service.confirmPayment(appOrderId);
  }

  /**
   * Nhân viên báo KHÁCH KHÔNG LIÊN HỆ ĐƯỢC / TỪ CHỐI nhận (đơn COD quay về).
   * Body: { reason: 'UNREACHABLE'|'REFUSED', photoUrl?, note? }
   * (Ảnh đơn quay về do frontend upload trước rồi truyền photoUrl.)
   */
  @Post(':appOrderId/no-show')
  reportNoShow(
    @Param('appOrderId') appOrderId: string,
    @Body() body: { reason?: string; photoUrl?: string; note?: string },
  ) {
    const reason = body?.reason === 'REFUSED' ? 'REFUSED' : 'UNREACHABLE';
    return this.service.reportNoShow(
      appOrderId,
      reason,
      body?.photoUrl ?? null,
      body?.note ?? null,
    );
  }

  /** In lại phiếu bếp/tem cho đơn online (máy in lỗi / in thêm). */
  @Post(':appOrderId/reprint')
  reprint(@Param('appOrderId') appOrderId: string) {
    return this.service.reprintAppOrder(appOrderId);
  }
}