import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppOrderView } from '../app-orders/app-orders.types';
import { OrderSessionView } from '../orders/types/order.types';
import {
  divider,
  EscPosBuilder,
  formatVnd,
  row,
  VietnameseMode,
} from './escpos.builder';
import { sendToPrinter } from './printer.transport';

type LienKind = 'CUSTOMER' | 'KITCHEN';

/**
 * Cơ chế in kép (Dual-print) thay màn hình bếp.
 * Bắn lệnh ESC/POS qua TCP/IP (cổng 9100) xuống máy K80, in nối tiếp 2 liên:
 *   - Liên 1 (CUSTOMER): "HÓA ĐƠN THANH TOÁN" + giá + "Cảm ơn Quý khách".
 *   - Liên 2 (KITCHEN):  "PHIẾU CHẾ BIẾN - LƯU QUẦY" cho pha chế.
 * Topping in thụt lề kiểu "+ Thêm Thạch".
 */
@Injectable()
export class PrintingService {
  private readonly logger = new Logger(PrintingService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly mode: VietnameseMode;
  private readonly codepage: number;
  private readonly shopName: string;

  constructor(config: ConfigService) {
    this.host = config.get<string>('PRINTER_HOST') ?? '127.0.0.1';
    this.port = Number(config.get('PRINTER_PORT') ?? 9100);
    this.mode =
      (config.get<string>('PRINTER_VIETNAMESE') as VietnameseMode) ?? 'strip';
    this.codepage = Number(config.get('PRINTER_CODEPAGE') ?? 0);
    this.shopName = config.get<string>('VIETQR_ACCOUNT_NAME') ?? 'QUAN CA PHE';
  }

  /**
   * In kép 2 liên nối tiếp. Best-effort + thử lại 1 lần:
   * lỗi máy in KHÔNG ném ra ngoài để không chặn luồng thanh toán.
   */
  async printDualBill(order: OrderSessionView): Promise<void> {
    const data = Buffer.concat([
      this.renderLien(order, 'CUSTOMER'),
      this.renderLien(order, 'KITCHEN'),
    ]);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sendToPrinter(this.host, this.port, data);
        this.logger.log(`Đã in 2 liên cho đơn ${order.orderCode}`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `In đơn ${order.orderCode} thất bại (lần ${attempt}): ${msg}`,
        );
      }
    }
    this.logger.error(
      `KHÔNG in được đơn ${order.orderCode} sau 2 lần thử (máy in ${this.host}:${this.port}).`,
    );
  }

  /** Dựng bytes ESC/POS cho 1 liên. */
  private renderLien(order: OrderSessionView, kind: LienKind): Buffer {
    const b = new EscPosBuilder(this.mode, this.codepage).init();
    const isCustomer = kind === 'CUSTOMER';

    // ----- Tiêu đề -----
    b.align('center').bold(true).size(2, 2);
    b.line(isCustomer ? 'HÓA ĐƠN THANH TOÁN' : 'PHIẾU CHẾ BIẾN');
    b.size(1, 1).bold(false);
    b.line(isCustomer ? this.shopName : '(LƯU QUẦY - PHA CHẾ)');
    b.line();

    // ----- Thông tin đơn -----
    b.align('left');
    b.line(`Mã đơn: ${order.orderCode}`);
    b.line(`Bàn: ${order.tableNumber ?? 'Mang đi / tại quầy'}`);
    b.line(`Giờ: ${new Date(order.createdAt).toLocaleString('vi-VN')}`);
    b.line(divider());

    // ----- Danh sách món -----
    for (const line of order.lines) {
      if (isCustomer) {
        b.bold(true)
          .line(
            row(
              `${line.quantity} x ${line.name}`,
              `${formatVnd(line.unitPrice * line.quantity)} đ`,
            ),
          )
          .bold(false);
        for (const t of line.toppings) {
          b.line(
            row(
              `   + ${t.name}`,
              t.unitPrice > 0 ? `${formatVnd(t.unitPrice * t.quantity)} đ` : '',
            ),
          );
        }
      } else {
        // Liên bếp: chữ to, không hiện giá
        b.bold(true).size(1, 2).line(`${line.quantity} x ${line.name}`);
        b.size(1, 1).bold(false);
        for (const t of line.toppings) b.line(`   + ${t.name}`);
      }
      if (line.note) b.line(`   (Ghi chú: ${line.note})`);
      b.line();
    }
    b.line(divider());

    // ----- Chân trang -----
    if (isCustomer) {
      b.bold(true)
        .size(1, 2)
        .line(row('TỔNG CỘNG:', `${formatVnd(order.total)} đ`));
      b.size(1, 1).bold(false).line();
      b.align('center').line('Cảm ơn Quý khách!');
    } else {
      b.align('center').line('Làm xong gạch mực • Cuối ca đối chiếu');
    }

    b.cut();
    return b.build();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ĐƠN ONLINE TỪ APP — in 2 liên: phiếu giao/gói + phiếu chế biến
  // ─────────────────────────────────────────────────────────────────────────
  async printAppOrder(order: AppOrderView): Promise<void> {
    const data = Buffer.concat([
      this.renderAppLien(order, 'PACKING'),
      this.renderAppLien(order, 'KITCHEN'),
    ]);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sendToPrinter(this.host, this.port, data);
        this.logger.log(`Đã in đơn online ${order.orderCode}`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `In đơn online ${order.orderCode} thất bại (lần ${attempt}): ${msg}`,
        );
      }
    }
    this.logger.error(
      `KHÔNG in được đơn online ${order.orderCode} (máy in ${this.host}:${this.port}).`,
    );
  }

  private renderAppLien(order: AppOrderView, kind: 'PACKING' | 'KITCHEN'): Buffer {
    const b = new EscPosBuilder(this.mode, this.codepage).init();
    const isPacking = kind === 'PACKING';
    const typeLabel = order.fulfillment === 'DELIVERY' ? 'GIAO HÀNG' : 'KHÁCH LẤY';

    b.align('center').bold(true).size(2, 2);
    b.line(isPacking ? `ĐƠN ONLINE - ${typeLabel}` : 'PHIẾU CHẾ BIẾN (ONLINE)');
    b.size(1, 1).bold(false);
    b.line(isPacking ? this.shopName : '(LƯU QUẦY - PHA CHẾ)');
    b.line();

    b.align('left');
    b.line(`Mã đơn: ${order.orderCode}`);
    b.line(`Giờ: ${new Date(order.receivedAt).toLocaleString('vi-VN')}`);
    if (isPacking) {
      b.line(`Khách: ${order.customerName ?? '-'}`);
      if (order.customerPhone) b.line(`DT: ${order.customerPhone}`);
      if (order.fulfillment === 'DELIVERY' && order.customerAddress) {
        b.line(`Dia chi: ${order.customerAddress}`);
      }
      b.line(`Thanh toan: ${order.paymentMethod === 'COD' ? 'COD (thu ho)' : 'Da CK'}`);
    }
    b.line(divider());

    for (const it of order.items) {
      if (isPacking) {
        b.bold(true)
          .line(
            row(
              `${it.quantity} x ${it.name}`,
              `${formatVnd(it.unitPrice * it.quantity)} đ`,
            ),
          )
          .bold(false);
      } else {
        b.bold(true).size(1, 2).line(`${it.quantity} x ${it.name}`);
        b.size(1, 1).bold(false);
      }
      if (it.note) b.line(`   (Ghi chú: ${it.note})`);
      b.line();
    }
    b.line(divider());

    if (isPacking) {
      b.bold(true).size(1, 2).line(row('TỔNG CỘNG:', `${formatVnd(order.totalAmount)} đ`));
      b.size(1, 1).bold(false);
      if (order.paymentMethod === 'COD') {
        b.bold(true).line(row('THU KHÁCH:', `${formatVnd(order.totalAmount)} đ`)).bold(false);
      }
      b.line().align('center').line('Cảm ơn Quý khách!');
    } else {
      b.align('center').line('Làm xong gạch mực');
    }

    b.cut();
    return b.build();
  }
}