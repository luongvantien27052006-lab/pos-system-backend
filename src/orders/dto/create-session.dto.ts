import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCounterSessionDto {
  /** Gán đơn vào 1 bàn (tùy chọn). Bỏ trống = đơn mang đi / chưa gán bàn. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  tableNumber?: string;
}