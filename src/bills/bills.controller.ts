// ==================================================================
//  POS BACKEND  src/bills/bills.controller.ts  (FILE MOI)
//  GET /api/bills?limit=200 — lich su ban hang (quay + ban + app).
// ==================================================================
import { Controller, Get, Query } from '@nestjs/common';
import { BillsService } from './bills.service';

@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('date') date?: string,
    @Query('month') month?: string,
  ) {
    const n = limit ? Math.min(Math.max(Number(limit) || 200, 1), 500) : 200;
    let from: string | undefined;
    let to: string | undefined;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      from = `${date}T00:00:00+07:00`;
      const d = new Date(from);
      d.setDate(d.getDate() + 1);
      to = d.toISOString();
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      from = `${month}-01T00:00:00+07:00`;
      const [y, m] = month.split('-').map(Number);
      const nm =
        m === 12
          ? `${y + 1}-01`
          : `${y}-${String(m + 1).padStart(2, '0')}`;
      to = `${nm}-01T00:00:00+07:00`;
    }
    return this.bills.list(n, from, to);
  }
}