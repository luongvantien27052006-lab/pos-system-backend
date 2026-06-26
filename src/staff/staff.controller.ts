import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ChangePinDto } from './dto/change-pin.dto';
import { VerifyPinDto } from './dto/verify-pin.dto';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** POST /api/staff/verify — { pin } -> { ok }. Dùng bởi trang đăng nhập frontend. */
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyPinDto) {
    return { ok: await this.staff.verify(dto.pin) };
  }

  /** POST /api/staff/change-pin — { currentPin, newPin }. */
  @Post('change-pin')
  @HttpCode(200)
  async change(@Body() dto: ChangePinDto) {
    await this.staff.changePin(dto.currentPin, dto.newPin);
    return { ok: true };
  }
}