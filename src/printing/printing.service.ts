// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/printing/printing.service.ts
//  >> CHEP DE — them ProductStampPayload + printProductStamp
// ==================================================================

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
import { PrintQueueService } from './print-queue.service';

type LienKind = 'CUSTOMER' | 'KITCHEN';
type PrintMode = 'queue' | 'tcp';

/** Dữ liệu 1 con tem dán ly/món gửi xuống máy in tem. */
export interface ProductStampPayload {
  orderCode: string;
  customerName: string;
  customerPhone: string;
  fulfillment: string; // 'DELIVERY' | 'PICKUP'
  itemName: string;
  currentCup: number; // tử số X — vị trí ly hiện tại trong toàn đơn
  totalCups: number; // mẫu số Y — tổng số ly toàn đơn
  options: unknown[]; // topping / mức đường - đá của ly
  note: string;
}

/**
 * Chuyển mảng tùy chọn (topping/đường-đá) — vốn lưu JSONB nên hình dạng linh
 * hoạt — về danh sách dòng chữ để in lên tem. Chấp nhận: chuỗi, {name/label},
 * {name,value}, hoặc fallback JSON.
 */
function stampOptionLines(options: unknown[]): string[] {
  if (!Array.isArray(options)) return [];
  const lines: string[] = [];
  for (const o of options) {
    if (o == null) continue;
    if (typeof o === 'string') {
      if (o.trim()) lines.push(o.trim());
      continue;
    }
    if (typeof o === 'object') {
      const r = o as Record<string, unknown>;
      const label = r.label ?? r.name ?? r.title ?? r.optionName;
      const value = r.value ?? r.choice ?? r.selected;
      if (typeof label === 'string' && typeof value === 'string') {
        lines.push(`${label}: ${value}`);
      } else if (typeof label === 'string') {
        lines.push(label);
      } else if (typeof value === 'string') {
        lines.push(value);
      } else {
        lines.push(JSON.stringify(o));
      }
      continue;
    }
    lines.push(String(o));
  }
  return lines;
}

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
  private readonly dispatchMode: PrintMode;

  constructor(
    config: ConfigService,
    private readonly queue: PrintQueueService,
  ) {
    this.host = config.get<string>('PRINTER_HOST') ?? '127.0.0.1';
    this.port = Number(config.get('PRINTER_PORT') ?? 9100);
    this.mode =
      (config.get<string>('PRINTER_VIETNAMESE') as VietnameseMode) ?? 'strip';
    this.codepage = Number(config.get('PRINTER_CODEPAGE') ?? 0);
    this.shopName = config.get<string>('VIETQR_ACCOUNT_NAME') ?? 'QUAN CA PHE';
    this.dispatchMode =
      (config.get<string>('PRINTER_MODE') as PrintMode) ?? 'queue';
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

    await this.dispatch('bill', data, `đơn ${order.orderCode}`);
    // In tem dán ly cho ĐƠN QUẦY (chạy nền, không ảnh hưởng bill).
    void this.printSessionStamps(order);
  }

  /**
   * In tem dán ly cho đơn tại quầy: mỗi ly một tem, đánh số X/Y toàn đơn.
   * Best-effort — lỗi không chặn/không ảnh hưởng bill.
   */
  async printSessionStamps(order: OrderSessionView): Promise<void> {
    try {
      const totalCups = order.lines.reduce((s, l) => s + l.quantity, 0);
      let currentCup = 1;
      for (const line of order.lines) {
        for (let i = 1; i <= line.quantity; i++) {
          await this.printProductStamp({
            orderCode: order.orderCode,
            customerName:
              order.tableNumber != null
                ? `Bàn ${order.tableNumber}`
                : 'Khách tại quầy',
            customerPhone: '',
            fulfillment: 'PICKUP',
            itemName: line.name,
            currentCup,
            totalCups,
            options: line.toppings,
            note: line.note ?? '',
          });
          currentCup++;
        }
      }
      if (totalCups > 0) {
        this.logger.log(
          `Đã xếp ${totalCups} tem ly cho đơn quầy ${order.orderCode}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `In tem đơn quầy ${order.orderCode} lỗi nền: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
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
    await this.dispatch('bill', data, `đơn online ${order.orderCode}`);
  }

  /**
   * In 1 con tem dán ly/món. Thử lại 1 lần; nếu vẫn lỗi -> NÉM ra để lớp gọi
   * (AppOrdersService.printProductStamps) ghi log tổng và không chặn luồng.
   */
  async printProductStamp(payload: ProductStampPayload): Promise<void> {
    const data = this.renderProductStamp(payload);
    await this.dispatch(
      'stamp',
      data,
      `tem ly ${payload.currentCup}/${payload.totalCups} đơn ${payload.orderCode}`,
    );
  }

  /** Dựng nội dung ESC/POS cho 1 con tem ly. */
  private renderProductStamp(p: ProductStampPayload): Buffer {
    const b = new EscPosBuilder(this.mode, this.codepage).init();
    const typeLabel = p.fulfillment === 'DELIVERY' ? 'GIAO HÀNG' : 'KHÁCH LẤY';

    // Số thứ tự ly TO + đậm để pha chế nhìn là biết ngay.
    b.align('center').bold(true).size(2, 2);
    b.line(`Ly ${p.currentCup}/${p.totalCups}`);
    b.size(1, 1).bold(false);
    b.line(`${p.orderCode}  -  ${typeLabel}`);
    b.line(divider());

    // Tên món (cỡ chữ cao).
    b.align('left').bold(true).size(1, 2);
    b.line(p.itemName);
    b.size(1, 1).bold(false);

    // Tùy chọn topping / mức đường - đá.
    for (const opt of stampOptionLines(p.options)) {
      b.line(`+ ${opt}`);
    }

    // Ghi chú riêng của ly.
    if (p.note && p.note.trim()) {
      b.line(`(Ghi chú: ${p.note.trim()})`);
    }

    b.line(divider());

    // Thông tin khách để gom đồ cuối luồng.
    b.line(`KH: ${p.customerName}`);
    if (p.customerPhone && p.customerPhone.trim()) {
      b.line(`DT: ${p.customerPhone}`);
    }

    b.cut();
    return b.build();
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

  /**
   * Gửi lệnh in. MẶC ĐỊNH xếp vào HÀNG ĐỢI cho agent tại quán kéo về
   * (backend cloud không với tới máy in LAN). Đặt PRINTER_MODE=tcp để in
   * thẳng khi backend chạy cùng mạng với máy in. Không ném lỗi (best-effort).
   */
  private async dispatch(
    target: 'bill' | 'stamp',
    data: Buffer,
    label: string,
  ): Promise<void> {
    if (this.dispatchMode === 'tcp') {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await sendToPrinter(this.host, this.port, data);
          this.logger.log(`Đã in ${label}`);
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`In ${label} thất bại (lần ${attempt}): ${msg}`);
        }
      }
      this.logger.error(
        `KHÔNG in được ${label} (máy in ${this.host}:${this.port}).`,
      );
      return;
    }
    try {
      await this.queue.enqueue(target, data);
      this.logger.log(`Đã xếp lệnh in [${target}] (${label}) cho agent`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Không xếp được lệnh in ${label}: ${msg}`);
    }
  }
}