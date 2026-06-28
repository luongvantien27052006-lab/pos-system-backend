// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/options.module.ts
//  >> CHEP DE (thay file co san)
// ==================================================================

import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { OptionsController } from './options.controller';
import { OptionsService } from './options.service';

@Module({
  imports: [SyncModule], // để re-sync topping sang App
  controllers: [OptionsController],
  providers: [OptionsService],
  exports: [OptionsService],
})
export class OptionsModule {}