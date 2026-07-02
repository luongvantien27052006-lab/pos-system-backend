// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/app.module.ts
//  >> CHEP DE (thay file co san)
// ==================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { AppOrdersModule } from './app-orders/app-orders.module';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { OptionsModule } from './options/options.module';
import { ProductsModule } from './products/products.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StaffModule } from './staff/staff.module';
import { StoreModule } from './store/store.module';
import { SyncModule } from './sync/sync.module';
import { TablesModule } from './tables/tables.module';
import { NewsModule } from './news/news.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    RealtimeModule,
    DashboardModule, // Phần 2.5 — doanh thu real-time (global)
    CatalogModule, // Phần 3 — menu + danh sách bàn cho frontend
    TablesModule, // Quản lý bàn (thêm/ngừng dùng) + nguồn cho mã QR
    StaffModule, // Xác thực PIN nhân viên + đổi PIN
    ProductsModule, // Quản lý sản phẩm + upload ảnh
    OptionsModule, // Quản lý topping/tùy chọn + gán món
    OrdersModule, // Phần 2.2 — tạo phiên, thêm món append-only, 3 kịch bản nghiệp vụ
    PaymentsModule, // Phần 2.4 — VietQR động + webhook SePay (idempotency)
    SyncModule, // Tích hợp: đồng bộ menu/kho + đẩy trạng thái đơn sang App
    AppOrdersModule, // Tích hợp: nhận đơn online từ App, in bếp, cập nhật trạng thái
    StoreModule, // Proxy cấu hình giờ mở/đóng cửa sang App
    NewsModule, // Quản lý Tin tức (proxy sang App + upload ảnh)
    // Phần 2.3: PrintingModule  (in kép ESC/POS qua TCP 9100)
    // Phần 2.4: PaymentsModule  (VietQR động + webhook ngân hàng -> PAID)
    // Phần 2.5: DashboardModule (doanh thu real-time)
  ],
  controllers: [AppController],
})
export class AppModule {}