import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * Doanh thu hôm nay. Admin gọi 1 lần khi mở dashboard để có số ban đầu,
   * sau đó chỉ cần nghe sự kiện Socket.io 'revenue:updated' để nhảy số.
   */
  @Get('revenue/today')
  todayRevenue() {
    return this.dashboard.getTodayRevenue();
  }
}