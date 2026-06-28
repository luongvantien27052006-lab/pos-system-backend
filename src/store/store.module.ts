// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/store/store.module.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';

@Module({
  controllers: [StoreController],
})
export class StoreModule {}