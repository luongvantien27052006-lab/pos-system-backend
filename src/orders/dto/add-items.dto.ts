import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OptionInputDto {
  @Type(() => Number)
  @IsInt()
  optionId!: number;
}

export class ItemInputDto {
  @Type(() => Number)
  @IsInt()
  productId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionInputDto)
  options?: OptionInputDto[];
}

export class AddItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemInputDto)
  items!: ItemInputDto[];
}