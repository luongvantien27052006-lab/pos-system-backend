export type PrepStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

export interface AppOrderItem {
  posProductId?: number | null;
  name: string;
  quantity: number;
  unitPrice: number;
  note?: string | null;
}

/** Đơn online đã dựng để hiển thị / in. */
export interface AppOrderView {
  id: number;
  appOrderId: string;
  orderCode: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  paymentMethod: 'COD' | 'BANK_QR';
  paymentStatus: 'PENDING' | 'PAID';
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  items: AppOrderItem[];
  totalAmount: number;
  prepStatus: PrepStatus;
  note: string | null;
  receivedAt: Date;
}