import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TablesModule } from './tables/tables.module';
import { SyncModule } from './sync/sync.module';
import { PrintingModule } from './printing/printing.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    RealtimeModule,
    DashboardModule, // Phần 2.5 — doanh thu real-time (global)
    CatalogModule, // Phần 3 — menu + danh sách bàn cho frontend
    TablesModule, // Quản lý bàn (thêm/ngừng dùng) + nguồn cho mã QR
    ProductsModule, // Quản lý sản phẩm + upload ảnh
    OrdersModule, // Phần 2.2 — tạo phiên, thêm món append-only, 3 kịch bản nghiệp vụ
    PaymentsModule, // Phần 2.4 — VietQR động + webhook SePay (idempotency)
    PrintingModule,  //(in kép ESC/POS qua TCP 9100)
    SyncModule,
  ],
  controllers: [AppController],
})
export class AppModule {}