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
  list(@Query('limit') limit?: string) {
    const n = limit ? Math.min(Math.max(Number(limit) || 200, 1), 500) : 200;
    return this.bills.list(n);
  }
}