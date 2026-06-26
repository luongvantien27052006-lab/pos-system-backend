import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @IsString()
  @IsNotEmpty()
  currentPin!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'Mã PIN mới phải gồm 4–6 chữ số' })
  newPin!: string;
}