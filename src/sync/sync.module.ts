// =============================================================================
//  REPO 1 (POS) · src/sync/sync.module.ts
//  Gắn InventorySyncService + controller nội bộ + worker chạy nền (drain outbox).
//  POS chưa cài @nestjs/schedule -> dùng setInterval gọn nhẹ (đủ cho 1 quán).
//  Nếu muốn chuẩn hơn: `npm i @nestjs/schedule` rồi thay bằng @Interval.
// =============================================================================
import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { InventorySyncService } from './inventory-sync.service';
import { InternalSyncController } from './internal-sync.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [InternalSyncController],
  providers: [InventorySyncService],
  exports: [InventorySyncService], // để ProductsModule import và gọi enqueue*
})
export class SyncModule implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SyncWorker');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly sync: InventorySyncService) {}

  onModuleInit(): void {
    // Mỗi 3s đẩy các event đang chờ. Khóa `running` để không chạy chồng.
    this.timer = setInterval(async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.sync.drainOutbox();
      } catch (e) {
        this.log.error('drainOutbox lỗi: ' + (e as Error).message);
      } finally {
        this.running = false;
      }
    }, 3000);
    this.log.log('Worker đồng bộ kho đã chạy (mỗi 3s).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}