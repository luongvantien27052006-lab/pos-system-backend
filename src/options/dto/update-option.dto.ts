// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/dto/update-option.dto.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateOptionDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
  @IsOptional() @IsString() @MaxLength(50) groupName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}