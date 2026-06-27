/**
 * Định nghĩa tập trung các "phòng" (room) và sự kiện Socket.io.
 * Các module Phần 2.2–2.5 chỉ việc import và gọi, không phát event tùy tiện.
 */

/** Tên các phòng Socket.io. */
export const ROOMS = {
  /** Mọi màn hình thu ngân (POS) — nhận đơn mới, cảnh báo ghim, xác nhận trả tiền. */
  POS: 'pos',
  /** Dashboard chủ quán — nhận số liệu doanh thu real-time. */
  ADMIN: 'admin',
  /** Màn hình khách của 1 bàn cụ thể (?table=04). */
  table: (tableNumber: string): string => `table:${tableNumber}`,
} as const;

/** Tên sự kiện server -> client. */
export const EVENTS = {
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  /** Bật cảnh báo ghim "đòi tiền mặt" trên POS (Persistent Alert). */
  ORDER_PENDING_CASH: 'order:pending_cash',
  /** Tắt cảnh báo + đóng bàn khi đã thu tiền. */
  ORDER_PAID: 'order:paid',
  /** Dashboard nhảy số doanh thu. */
  REVENUE_UPDATED: 'revenue:updated',
  /** Đơn online từ App vừa tới — màn thu ngân hiện + chuông. */
  APP_ORDER_INCOMING: 'app_order:incoming',
  /** Trạng thái chế biến đơn online thay đổi. */
  APP_ORDER_STATUS: 'app_order:status',
  /** Khách HỦY đơn online — màn thu ngân cảnh báo (chuông + thẻ đỏ). */
  APP_ORDER_CANCELLED: 'app_order:cancelled',
} as const;

// ----- Kiểu payload dùng chung -----

export interface OrderPendingCashPayload {
  sessionId: number;
  orderCode: string;
  tableNumber: string | null;
  amount: number;
}

export interface OrderPaidPayload {
  sessionId: number;
  tableNumber: string | null;
  paymentMethod: 'CASH' | 'BANK_TRANSFER';
}

export interface RevenueUpdatedPayload {
  /** Ngày theo giờ VN, dạng YYYY-MM-DD. */
  date: string;
  total: number;
  totalCash: number;
  totalTransfer: number;
  /** Phần doanh thu đến từ đơn online (App). Đã gộp sẵn vào `total`. */
  appTotal: number;
}

export interface AppOrderIncomingPayload {
  id: number;
  appOrderId: string;
  orderCode: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  total: number;
  customerName: string | null;
  itemCount: number;
}

export interface AppOrderStatusPayload {
  id: number;
  appOrderId: string;
  orderCode: string;
  prepStatus: string;
  paymentStatus: 'PENDING' | 'PAID';
}

export interface AppOrderCancelledPayload {
  id: number;
  appOrderId: string;
  orderCode: string;
}