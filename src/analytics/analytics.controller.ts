import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.service.summary(days ? Number(days) : 30);
  }
}