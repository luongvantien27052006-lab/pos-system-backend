import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm'; // <--- Đã bổ sung dòng import
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsInternalController } from './products-internal.controller';
import { AuthModule } from '../auth/auth.module';
import { Product } from './entities/product.entity'; //
@Module({
// Bổ sung mảng imports này để cấp phép cho Repository hoạt động
  imports: [TypeOrmModule.forFeature([Product]),AuthModule],

  controllers: [ProductsController, ProductsInternalController],
  providers: [ProductsService],
  exports: [ProductsService]
})
export class ProductsModule {}