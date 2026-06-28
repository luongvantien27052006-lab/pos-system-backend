// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/options.module.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Module } from '@nestjs/common';
import { OptionsController } from './options.controller';
import { OptionsService } from './options.service';

@Module({
  controllers: [OptionsController],
  providers: [OptionsService],
  exports: [OptionsService],
})
export class OptionsModule {}