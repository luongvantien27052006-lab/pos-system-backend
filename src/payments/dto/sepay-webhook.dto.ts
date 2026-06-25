import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Payload webhook SePay. Chỉ khai báo các trường ta dùng; trường lạ bị
 * ValidationPipe (whitelist) lược bỏ.
 */
export class SepayWebhookDto {
  @IsNumber()
  id!: number; // mã giao dịch SePay -> khóa idempotency

  @IsNumber()
  transferAmount!: number;

  @IsString()
  transferType!: string; // 'in' = tiền vào

  @IsOptional()
  @IsString()
  content?: string; // nội dung CK (chứa mã đơn)

  @IsOptional()
  @IsString()
  gateway?: string; // tên ngân hàng

  @IsOptional()
  @IsString()
  referenceCode?: string;
}