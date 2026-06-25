import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'Số bàn chỉ gồm chữ và số, không dấu và không khoảng trắng',
  })
  tableNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  displayName?: string;
}