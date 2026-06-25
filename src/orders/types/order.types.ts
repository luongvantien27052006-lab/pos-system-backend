// Kiểu khớp với ENUM trong CSDL (Phần 1)
export type OrderStatus = 'UNPAID' | 'PENDING_CASH' | 'PAID' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
export type OrderChannel = 'TABLE_QR' | 'COUNTER_POS';
export type OrderItemType = 'PRODUCT' | 'OPTION';
export type OrderItemStatus = 'ACTIVE' | 'VOIDED';

/**
 * Row của order_sessions (đã JOIN tables để lấy table_number).
 * Lưu ý: pg trả NUMERIC dưới dạng chuỗi -> total_amount/unit_price là string.
 */
export interface OrderSessionRow {
  id: number;
  order_code: string;
  table_id: number | null;
  table_number: string | null; // từ JOIN tables
  channel: OrderChannel;
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  total_amount: string;
  note: string | null;
  printed_at: Date | null; 
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow {
  id: number;
  session_id: number;
  parent_item_id: number | null;
  item_type: OrderItemType;
  product_id: number | null;
  option_id: number | null;
  name_snapshot: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  note: string | null;
  status: OrderItemStatus;
  voided_at: Date | null;
  created_at: Date;
}

// ----- Cấu trúc trả về client (đã gom Cha–Con) -----

export interface ToppingView {
  id: number;
  optionId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderLineView {
  id: number;
  productId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
  note: string | null;
  toppings: ToppingView[];
  lineTotal: number; // đã gồm tiền topping
}

export interface OrderSessionView {
  id: number;
  orderCode: string;
  tableId: number | null;
  tableNumber: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  lines: OrderLineView[];
  total: number;
  createdAt: Date;
}