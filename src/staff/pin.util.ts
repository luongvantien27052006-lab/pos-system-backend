import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/** Băm PIN với salt ngẫu nhiên. Định dạng lưu: "<salt_hex>:<hash_hex>". */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Đối chiếu PIN với chuỗi đã băm, so sánh chống tấn công thời gian. */
export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}