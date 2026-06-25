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
}