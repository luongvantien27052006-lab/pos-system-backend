// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/dto/create-option.dto.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateOptionDto {
  @IsString() @MaxLength(100) name!: string;
  @Type(() => Number) @IsInt() @Min(0) price!: number;
  /** Nhóm hiển thị, ví dụ 'Topping', 'Đường', 'Đá'. */
  @IsOptional() @IsString() @MaxLength(50) groupName?: string;
}