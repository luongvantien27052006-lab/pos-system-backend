import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
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
}