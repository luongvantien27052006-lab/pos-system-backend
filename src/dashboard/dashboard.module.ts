import { Global, Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** @Global: OrdersService & PaymentsService inject DashboardService để cộng dồn sau khi PAID. */
@Global()
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}