import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import {
  ReviewsController,
  ReviewsInternalController,
} from './reviews.controller';

@Module({
  controllers: [ReviewsInternalController, ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}