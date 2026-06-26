import { Module } from '@nestjs/common';
import { PrintingModule } from '../printing/printing.module';
import {
  AppOrdersController,
  AppOrdersInternalController,
} from './app-orders.controller';
import { AppOrdersService } from './app-orders.service';

@Module({
  // PrintingModule không @Global -> phải import để dùng máy in.
  // DatabaseService & RealtimeGateway là @Global nên không cần import.
  imports: [PrintingModule],
  controllers: [AppOrdersInternalController, AppOrdersController],
  providers: [AppOrdersService],
  exports: [AppOrdersService],
})
export class AppOrdersModule {}