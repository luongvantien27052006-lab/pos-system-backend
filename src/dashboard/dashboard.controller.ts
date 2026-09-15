// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/dashboard/dashboard.controller.ts
//  >> CHEP DE (thay file co san)
// ==================================================================

import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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

  /** Doanh thu tháng hiện tại (từ ngày 1 đến nay). Admin gọi khi mở dashboard. */
  @Get('revenue/month')
  monthlyRevenue() {
    return this.dashboard.getMonthlyRevenue();
  }

  /** So sánh nhanh: hôm nay vs hôm qua, tháng này vs tháng trước. */
  @Get('revenue/compare')
  compare() {
    return this.dashboard.getRevenueCompare();
  }

  /** Tiền mặt kỳ vọng (để đối chiếu khi chốt sổ). ?date=YYYY-MM-DD (mặc định hôm nay). */
  @Get('cash')
  cashExpected(@Query('date') date?: string) {
    return this.dashboard.getCashExpected(date);
  }

  /** Lưu một lần chốt sổ (đếm tiền mặt thực tế). */
  @Post('cash')
  saveCash(@Body() b: { date?: string; counted?: number; note?: string }) {
    return this.dashboard.saveCashReconcile(
      b?.date,
      Number(b?.counted ?? 0),
      b?.note,
    );
  }

  /** Lịch sử chốt sổ gần đây. */
  @Get('cash/history')
  cashHistory() {
    return this.dashboard.listCashReconciles(30);
  }
}