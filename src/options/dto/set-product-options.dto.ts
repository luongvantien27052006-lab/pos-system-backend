// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/options/dto/set-product-options.dto.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Type } from 'class-transformer';
import { IsArray, IsInt } from 'class-validator';

export class SetProductOptionsDto {
  /** Danh sách id topping áp dụng cho món (thay thế toàn bộ). */
  @IsArray() @Type(() => Number) @IsInt({ each: true }) optionIds!: number[];
}