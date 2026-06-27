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
}