import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';

/**
 * Dữ liệu multipart/form-data (mọi field về dạng chuỗi).
 * @Type(() => Number) + ValidationPipe transform sẽ ép price/category_id sang số.
 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsInt()
  category_id!: number;
}