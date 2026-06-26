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
 * NỘI BỘ — App gọi sang qua private network. Route thật: /api/internal/orders/incoming
 * Chặn bằng secret nội bộ (không CORS, không JWT người dùng).
 */
@Controller('internal/orders')
export class AppOrdersInternalController {
  constructor(private readonly service: AppOrdersService) {}

  @Post('incoming')
  receive(@Headers('x-internal-secret') secret: string | undefined, @Body() dto: ReceiveAppOrderDto) {
    if (secret !== process.env.INTERNAL_SYNC_SECRET) throw new ForbiddenException('Sai secret nội bộ');
    return this.service.receiveFromApp(dto);
  }
}

/**
 * CHO MÀN THU NGÂN (frontend POS gọi). Route thật: /api/app-orders/...
 * Cùng tầng bảo vệ với các endpoint POS khác (PIN cookie ở frontend middleware).
 */
@Controller('app-orders')
export class AppOrdersController {
  constructor(private readonly service: AppOrdersService) {}

  /** Danh sách đơn online đang hoạt động (dùng để render + đồng bộ lại khi reconnect). */
  @Get('active')
  active() {
    return this.service.listActive();
  }

  /** Đổi trạng thái chế biến: CONFIRMED -> IN_PROGRESS -> READY -> DELIVERED (hoặc CANCELLED). */
  @Patch(':appOrderId/status')
  updateStatus(@Param('appOrderId') appOrderId: string, @Body() dto: UpdatePrepStatusDto) {
    return this.service.updateStatus(appOrderId, dto.status);
  }
}