import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Sinh VietQR động cho phiên — dùng khi khách/quầy chọn chuyển khoản, hoặc khi
   * thu ngân bấm "Hiện mã QR chuyển khoản" trên thanh cảnh báo ghim (Kịch bản 3).
   */
  @Post(':sessionId/qr')
  createQr(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.payments.createQr(sessionId);
  }

  /** Webhook SePay gọi vào khi có biến động số dư (tiền về). */
  @Post('sepay/webhook')
  @HttpCode(200)
  sepayWebhook(
    @Headers('authorization') auth: string | undefined,
    @Body() dto: SepayWebhookDto,
  ) {
    return this.payments.handleSepayWebhook(auth, dto);
  }
}