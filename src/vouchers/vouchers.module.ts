import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';

@Module({ controllers: [VouchersController] })
export class VouchersModule {}