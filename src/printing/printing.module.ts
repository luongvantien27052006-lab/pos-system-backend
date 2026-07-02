// ============================================================
//  POS BACKEND (NestJS + raw pg)
//  src/printing/printing.module.ts
//  >> CHEP DE (dang ky PrintQueueService + PrintController)
// ============================================================

import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrintQueueService } from './print-queue.service';
import { PrintController } from './print.controller';

@Module({
  controllers: [PrintController],
  providers: [PrintingService, PrintQueueService],
  exports: [PrintingService],
})
export class PrintingModule {}