// POS BACKEND  src/refunds/refunds.controller.ts  (FILE MỚI)
import { Body, Controller, Get, Post } from '@nestjs/common';
import { RefundsService } from './refunds.service';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** Danh sách yêu cầu hoàn tiền đang chờ (từ App). */
  @Get('pending')
  pending() {
    return this.refunds.listPending();
  }

  /** Đánh dấu đã hoàn tiền xong cho 1 yêu cầu. */
  @Post('complete')
  complete(@Body() b: { refundId?: string; note?: string }) {
    return this.refunds.complete(b?.refundId ?? '', b?.note);
  }
}
