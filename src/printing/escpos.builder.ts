import * as iconv from 'iconv-lite';

export type VietnameseMode = 'strip' | 'cp1258';

/** Bề rộng giấy K80 (80mm) ~ 48 ký tự với Font A. */
export const LINE_WIDTH = 48;

/** Bỏ dấu tiếng Việt -> ASCII (an toàn với mọi máy in). */
export function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Định dạng tiền VND: 30000 -> "30.000". */
export function formatVnd(n: number): string {
  return Math.round(n).toLocaleString('vi-VN');
}

/** Một dòng "trái ... phải" canh đều theo bề rộng giấy. */
export function row(left: string, right: string, width = LINE_WIDTH): string {
  const gap = width - left.length - right.length;
  return gap > 0 ? left + ' '.repeat(gap) + right : `${left} ${right}`;
}

/** Đường kẻ ngang. */
export function divider(ch = '-', width = LINE_WIDTH): string {
  return ch.repeat(width);
}

/**
 * Bộ dựng lệnh ESC/POS. Mỗi lệnh tích vào một Buffer, gọi build() để lấy bytes
 * gửi thẳng qua TCP/IP xuống máy in. Tự xử lý tiếng Việt theo `mode`.
 */
export class EscPosBuilder {
  private chunks: Buffer[] = [];

  constructor(
    private readonly mode: VietnameseMode = 'strip',
    private readonly codepage = 0,
  ) {}

  private cmd(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /** ESC @ — reset máy in; chọn bảng mã nếu dùng cp1258. */
  init(): this {
    this.cmd(0x1b, 0x40);
    if (this.mode === 'cp1258' && this.codepage) {
      this.cmd(0x1b, 0x74, this.codepage); // ESC t n
    }
    return this;
  }

  align(a: 'left' | 'center' | 'right'): this {
    const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
    return this.cmd(0x1b, 0x61, n); // ESC a n
  }

  bold(on: boolean): this {
    return this.cmd(0x1b, 0x45, on ? 1 : 0); // ESC E n
  }

  /** Phóng to chữ: w, h trong 1..8 lần (GS ! n). */
  size(w = 1, h = 1): this {
    const ww = Math.max(1, Math.min(8, w)) - 1;
    const hh = Math.max(1, Math.min(8, h)) - 1;
    return this.cmd(0x1d, 0x21, ((ww << 4) | hh) & 0xff);
  }

  text(s: string): this {
    this.chunks.push(this.encode(s));
    return this;
  }

  line(s = ''): this {
    return this.text(s).cmd(0x0a); // LF
  }

  feed(n = 1): this {
    return this.cmd(0x1b, 0x64, n); // ESC d n
  }

  /** Đẩy giấy và cắt. */
  cut(): this {
    this.feed(3);
    return this.cmd(0x1d, 0x56, 0x00); // GS V 0 (cắt full)
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }

  private encode(s: string): Buffer {
    if (this.mode === 'cp1258') return iconv.encode(s, 'cp1258');
    return Buffer.from(removeVietnameseTones(s), 'latin1');
  }
}