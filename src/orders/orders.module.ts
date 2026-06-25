import { Module } from '@nestjs/common';
import { PrintingModule } from '../printing/printing.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrintingModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService], // Phần 2.4 (PaymentsModule) dùng lại markSessionPaid()
})
export class OrdersModule {}