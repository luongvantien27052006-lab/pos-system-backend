// POS BACKEND  src/refunds/refunds.controller.ts
import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { RefundsService } from './refunds.service';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** Danh sách yêu cầu hoàn tiền đang chờ (từ App). */
  @Get('pending')
  pending() {
    return this.refunds.listPending();
  }

  /** Lịch sử hoàn tiền đã xong (từ App) — để đối chiếu. */
  @Get('completed')
  completed() {
    return this.refunds.listCompleted();
  }

  /** Log đối chiếu phía POS. */
  @Get('log')
  log() {
    return this.refunds.localLog(100);
  }

  /** Đối chiếu 2 đầu (App vs POS) — tìm giao dịch lệch. */
  @Get('reconcile')
  reconcile() {
    return this.refunds.reconcile();
  }

  /** Đánh dấu đã hoàn tiền xong. completedBy lấy từ vai trò đăng nhập (proxy chèn). */
  @Post('complete')
  complete(
    @Body() b: { refundId?: string; note?: string },
    @Headers('x-pos-user') user?: string,
  ) {
    return this.refunds.complete(b?.refundId ?? '', user, b?.note);
  }

  /** Từ chối yêu cầu hoàn tiền (kèm lý do). */
  @Post('reject')
  reject(
    @Body() b: { refundId?: string; reason?: string },
    @Headers('x-pos-user') user?: string,
  ) {
    return this.refunds.reject(b?.refundId ?? '', b?.reason ?? '', user);
  }
}
