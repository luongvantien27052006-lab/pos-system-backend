// ============================================================
//  POS BACKEND  src/common/guards/pos-secret.guard.ts
//  >> FILE MỚI — chặn gọi API trực tiếp (không qua proxy Next.js).
// ============================================================
//
//  Mọi request phải kèm header `x-pos-secret` = POS_PROXY_SECRET (do proxy
//  Next.js tự thêm). Nhờ vậy backend KHÔNG thể bị gọi thẳng từ ngoài, kể cả
//  khi biết URL backend (vốn lộ trong bundle frontend trước đây).
//
//  Bỏ qua cho các route có cơ chế xác thực RIÊNG:
//   - /internal/*        (x-internal-secret — App gọi sang)
//   - /payments/webhook  (chữ ký SePay)
//
//  Fail-open khi CHƯA đặt POS_PROXY_SECRET (không làm gãy POS lúc chưa bật),
//  kèm cảnh báo nhắc cấu hình.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class PosSecretGuard implements CanActivate {
  private readonly logger = new Logger(PosSecretGuard.name);
  private readonly secret?: string;
  private warned = false;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('POS_PROXY_SECRET') || undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path || req.originalUrl || req.url || '';

    // Route có auth riêng -> bỏ qua guard này.
    if (path.includes('/internal/') || path.includes('/payments/webhook')) {
      return true;
    }

    if (!this.secret) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'POS_PROXY_SECRET chưa đặt — API đang MỞ (không xác thực). ' +
            'Hãy đặt POS_PROXY_SECRET (backend) + POS_BACKEND_URL/POS_PROXY_SECRET ' +
            '(frontend) và deploy để bật bảo vệ.',
        );
      }
      return true; // fail-open: không chặn khi chưa cấu hình
    }

    const got = req.headers['x-pos-secret'];
    if (typeof got === 'string' && got === this.secret) return true;
    throw new UnauthorizedException('Thiếu hoặc sai khoá truy cập POS');
  }
}
