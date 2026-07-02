// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/printing/print.controller.ts
//  >> FILE MOI — API cho agent in tai quan (khoa bang PRINT_AGENT_SECRET)
//  Route: /api/print/pull , /api/print/ack
// ==================================================================

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrintQueueService } from './print-queue.service';

@Controller('print')
export class PrintController {
  constructor(private readonly queue: PrintQueueService) {}

  private guard(secret?: string) {
    const expected = process.env.PRINT_AGENT_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Sai khoá agent in');
    }
  }

  /** Agent kéo danh sách lệnh in đang chờ. */
  @Get('pull')
  async pull(
    @Headers('x-print-secret') secret: string,
    @Query('limit') limit?: string,
  ) {
    this.guard(secret);
    const n = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const jobs = await this.queue.pull(n);
    return { jobs };
  }

  /** Agent báo đã in xong các job. */
  @Post('ack')
  @HttpCode(200)
  async ack(
    @Headers('x-print-secret') secret: string,
    @Body() body: { ids?: string[] },
  ) {
    this.guard(secret);
    await this.queue.ack(Array.isArray(body?.ids) ? body.ids : []);
    return { ok: true };
  }
}