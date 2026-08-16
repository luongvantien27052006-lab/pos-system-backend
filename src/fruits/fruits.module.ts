// ==================================================================
//  POS BACKEND  src/fruits/fruits.module.ts
//  >> CHEP DE — thêm SyncModule (để enqueue đồng bộ) + FruitsService.
// ==================================================================
import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { FruitsController } from './fruits.controller';
import { FruitsService } from './fruits.service';

@Module({
  imports: [SyncModule], // InventorySyncService để đẩy món sang App
  controllers: [FruitsController],
  providers: [FruitsService],
})
export class FruitsModule {}