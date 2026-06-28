import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { hashPin, verifyPin } from './pin.util';

const PIN_KEY = 'staff_pin_hash';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);
  private ready = false;

  constructor(private readonly db: DatabaseService) {}

  /** Tạo bảng app_settings (nếu chưa có) + seed PIN ban đầu từ env STAFF_PIN. */
  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS app_settings (
         key        VARCHAR(50) PRIMARY KEY,
         value      TEXT        NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const existing = await this.getPinHash();
    if (!existing) {
      const initial = process.env.STAFF_PIN;
      if (initial) {
        await this.setPinHash(hashPin(initial));
        this.logger.log('Đã khởi tạo mã PIN nhân viên từ STAFF_PIN');
      } else {
        this.logger.warn(
          'Chưa cấu hình STAFF_PIN — chưa thể đăng nhập nhân viên cho tới khi đặt PIN',
        );
      }
    }
    this.ready = true;
  }

  private async getPinHash(): Promise<string | null> {
    const row = await this.db.queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [PIN_KEY],
    );
    return row?.value ?? null;
  }

  private async setPinHash(hash: string): Promise<void> {
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [PIN_KEY, hash],
    );
  }

  /** Đối chiếu PIN đăng nhập. */
 /** Đối chiếu PIN đăng nhập. */
  async verify(pin: string): Promise<boolean> {
    await this.ensureReady();
    const hash = await this.getPinHash();
    
    // 🔍 ĐOẠN LOG GIÁM SÁT BẮT SỐNG DỮ LIỆU
    console.log("==========================================");
    console.log("[DEBUG PIN] Mã PIN người dùng gõ nhập vào:", pin);
    console.log("[DEBUG PIN] Chuỗi mã hóa Backend đọc được từ DB:", hash);
    console.log("==========================================");

    // 🚀 MẸO KIỂM TRA: Bỏ dấu hai xẹt (//) ở dòng dưới nếu bạn muốn ÉP VÀO THẲNG HỆ THỐNG để test các tính năng khác:
    // if (pin === '1234') return true;

    if (!hash) return false;
    return verifyPin(pin, hash);
  }

  /** Đổi PIN: phải nhập đúng PIN hiện tại; PIN mới 4–6 chữ số. */
  async changePin(currentPin: string, newPin: string): Promise<void> {
    await this.ensureReady();
    if (!/^\d{4,6}$/.test(newPin)) {
      throw new BadRequestException('Mã PIN mới phải gồm 4–6 chữ số');
    }
    const ok = await this.verify(currentPin);
    if (!ok) {
      throw new BadRequestException('Mã PIN hiện tại không đúng');
    }
    await this.setPinHash(hashPin(newPin));
    this.logger.log('Mã PIN nhân viên đã được đổi');
  }
}