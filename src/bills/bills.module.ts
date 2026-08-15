// ==================================================================
//  POS BACKEND  src/bills/bills.module.ts  (FILE MOI)
//  DatabaseModule la @Global nen khong can import lai.
// ==================================================================
import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';

@Module({
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}