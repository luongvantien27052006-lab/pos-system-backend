// ============================================================
//  POS BACKEND  src/staff/dto/change-pin.dto.ts
//  >> CHEP DE (them target)
// ============================================================

import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @IsString()
  @IsNotEmpty()
  currentPin!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'Mã PIN mới phải gồm 4–6 chữ số' })
  newPin!: string;

  @IsOptional()
  @IsIn(['staff', 'admin'])
  target?: 'staff' | 'admin';
}