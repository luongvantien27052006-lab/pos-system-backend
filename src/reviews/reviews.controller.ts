import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';

/** App đẩy review sang (nội bộ, cần secret). */
@Controller('internal/reviews')
export class ReviewsInternalController {
  constructor(private readonly service: ReviewsService) {}

  private guard(secret?: string) {
    if (secret !== process.env.INTERNAL_SYNC_SECRET) {
      throw new ForbiddenException('Sai secret nội bộ');
    }
  }

  @Post('incoming')
  incoming(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: any,
  ) {
    this.guard(secret);
    return this.service.receiveFromApp(body);
  }
}

/** Màn POS xem đánh giá (route: /api/reviews/...). */
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  /** Đánh giá xấu (<= 3 sao) — app KHÔNG hiện, chỉ quán xem để xử lý. */
  @Get('negative')
  negative(@Query('status') status?: string) {
    return this.service.negative(status === 'all' ? 'all' : 'open');
  }

  @Get('negative/count')
  negativeCount() {
    return this.service.negativeCount();
  }

  /** Đánh dấu đã xử lý / mở lại. Người xử lý lấy từ vai trò đăng nhập (proxy chèn). */
  @Post(':id/handled')
  handled(
    @Param('id') id: string,
    @Body() b: { handled?: boolean; note?: string },
    @Headers('x-pos-user') user?: string,
  ) {
    return this.service.setHandled(id, b?.handled !== false, user, b?.note);
  }
}
