/** Sinh mã VietQR động theo chuẩn EMVCo (Napas) + URL ảnh QR tiện dụng. */

/** Một trường TLV: id + độ dài (2 chữ số) + giá trị. */
function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) — 4 ký tự hex hoa. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface VietQrInput {
  bankBin: string;
  accountNo: string;
  amount?: number;
  content?: string;
}

/** Trả về payload EMVCo (chuỗi dùng để render thành mã QR). */
export function buildVietQrPayload({
  bankBin,
  accountNo,
  amount,
  content,
}: VietQrInput): string {
  const beneficiary = tlv('00', bankBin) + tlv('01', accountNo);
  const merchant =
    tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');

  let payload =
    tlv('00', '01') +
    tlv('01', amount && amount > 0 ? '12' : '11') +
    tlv('38', merchant) +
    tlv('53', '704');

  if (amount && amount > 0) payload += tlv('54', String(Math.round(amount)));
  payload += tlv('58', 'VN');
  if (content) payload += tlv('62', tlv('08', content));

  payload += '6304'; // tag + length của CRC, tính trên toàn bộ chuỗi phía trước
  return payload + crc16(payload);
}

/** URL ảnh QR (img.vietqr.io) — frontend chỉ cần gắn vào thẻ <img>. */
export function buildVietQrImageUrl(
  { bankBin, accountNo, amount, content }: VietQrInput,
  accountName?: string,
): string {
  const params = new URLSearchParams();
  if (amount && amount > 0) params.set('amount', String(Math.round(amount)));
  if (content) params.set('addInfo', content);
  if (accountName) params.set('accountName', accountName);
  return `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?${params.toString()}`;
}