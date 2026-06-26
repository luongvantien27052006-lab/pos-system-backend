import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class AppOrderCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
}

export class AppOrderItemDto {
  /** id sản phẩm bên POS (nếu App đã map sẵn) — không bắt buộc cho việc in. */
  @IsOptional() @IsInt() posProductId?: number;

  @IsString() name!: string;

  @Type(() => Number) @IsInt() @Min(1) quantity!: number;

  @Type(() => Number) @IsInt() @Min(0) unitPrice!: number;

  @IsOptional() @IsString() note?: string;
}

/** Body App gửi sang POS: POST /api/internal/orders/incoming */
export class ReceiveAppOrderDto {
  @IsUUID() eventId!: string;
  @IsUUID() appOrderId!: string;

  @IsString() orderCode!: string;

  /** ISO time tạo đơn bên App. */
  @IsOptional() @IsString() createdAt?: string;

  @IsIn(['DELIVERY', 'PICKUP']) fulfillment!: 'DELIVERY' | 'PICKUP';
  @IsIn(['COD', 'BANK_QR']) paymentMethod!: 'COD' | 'BANK_QR';
  @IsOptional() @IsIn(['PENDING', 'PAID']) paymentStatus?: 'PENDING' | 'PAID';

  /** Trạng thái ban đầu khi đẩy sang (mặc định CONFIRMED). */
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'])
  status?: string;

  @IsOptional() @ValidateNested() @Type(() => AppOrderCustomerDto)
  customer?: AppOrderCustomerDto;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AppOrderItemDto)
  items!: AppOrderItemDto[];

  @Type(() => Number) @IsInt() @Min(0) totalAmount!: number;

  @IsOptional() @IsString() note?: string;
}