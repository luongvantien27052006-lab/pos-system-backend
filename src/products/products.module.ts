import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  // SyncModule export InventorySyncService -> ProductsService inject được.
  // (DatabaseService là @Global nên không cần import lại.)
  imports: [SyncModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}