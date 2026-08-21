// ==================================================================
//  POS BACKEND  src/bills/bills.service.ts  (FILE MOI)
//  Tong hop LICH SU BILL tu 3 nguon:
//   - Don tai QUAY  (order_sessions.channel = COUNTER_POS, status = PAID)
//   - Don tai BAN   (order_sessions.channel = TABLE_QR,   status = PAID)
//   - Don APP       (bang app_orders — app gui sang)
//  Kem: ngay gio, mon + topping, gia mon + gia topping, tong tien, nguon don.
// ==================================================================

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface BillTopping {
  name: string;
  unitPrice: number;
}
export interface BillItem {
  name: string;
  unitPrice: number;
  quantity: number;
  toppings: BillTopping[];
}
export interface Bill {
  source: 'COUNTER' | 'TABLE' | 'APP';
  code: string | null;
  createdAt: string | null;
  paymentMethod: string | null;
  paymentStatus?: string | null;
  prepStatus?: string | null;
  fulfillment?: string | null;
  total: number;
  tableNumber?: string | null;
  customer?: { name: string | null; phone: string | null } | null;
  items: BillItem[];
}

@Injectable()
export class BillsService {
  constructor(private readonly db: DatabaseService) {}

  async list(limit = 200, from?: string, to?: string): Promise<Bill[]> {
    const posBills = await this.loadPosBills(limit, from, to);
    const appBills = await this.loadAppBills(limit, from, to);
    const all = [...posBills, ...appBills].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta; // moi nhat len dau
    });
    return all.slice(0, limit);
  }

  // ── Don tai quay/ban (order_sessions + order_items) ──
  private async loadPosBills(
    limit: number,
    from?: string,
    to?: string,
  ): Promise<Bill[]> {
    const sessions = await this.db.query<{
      id: number;
      order_code: string;
      channel: string;
      payment_method: string | null;
      total_amount: string | null;
      completed_at: Date | null;
      created_at: Date | null;
      table_number: string | null;
    }>(
      `SELECT s.id, s.order_code, s.channel, s.payment_method,
              s.total_amount, s.completed_at, s.created_at, t.table_number
         FROM order_sessions s
         LEFT JOIN tables t ON t.id = s.table_id
        WHERE s.status = 'PAID'
          ${from && to ? 'AND s.completed_at >= $2 AND s.completed_at < $3' : ''}
        ORDER BY s.completed_at DESC NULLS LAST
        LIMIT $1`,
      from && to ? [limit, from, to] : [limit],
    );
    if (!sessions.length) return [];

    const ids = sessions.map((s) => s.id);
    const items = await this.db.query<{
      id: number;
      session_id: number;
      parent_item_id: number | null;
      item_type: string;
      name_snapshot: string;
      unit_price: string;
      quantity: number;
    }>(
      `SELECT id, session_id, parent_item_id, item_type,
              name_snapshot, unit_price, quantity
         FROM order_items
        WHERE session_id = ANY($1::bigint[]) AND status <> 'VOIDED'
        ORDER BY id`,
      [ids],
    );

    const bySession = new Map<number, typeof items>();
    for (const it of items) {
      const arr = bySession.get(it.session_id) ?? ([] as typeof items);
      arr.push(it);
      bySession.set(it.session_id, arr);
    }

    return sessions.map((s) => {
      const list = bySession.get(s.id) ?? [];
      const toppingsByParent = new Map<number, BillTopping[]>();
      for (const i of list) {
        if (i.item_type === 'OPTION' && i.parent_item_id != null) {
          const arr = toppingsByParent.get(i.parent_item_id) ?? [];
          arr.push({ name: i.name_snapshot, unitPrice: Number(i.unit_price) });
          toppingsByParent.set(i.parent_item_id, arr);
        }
      }
      const products = list.filter((i) => i.item_type === 'PRODUCT');
      return {
        source: s.channel === 'TABLE_QR' ? 'TABLE' : 'COUNTER',
        code: s.order_code,
        createdAt: (s.completed_at ?? s.created_at)?.toISOString() ?? null,
        paymentMethod: s.payment_method,
        total: Number(s.total_amount ?? 0),
        tableNumber: s.table_number,
        customer: null,
        items: products.map((p) => ({
          name: p.name_snapshot,
          unitPrice: Number(p.unit_price),
          quantity: p.quantity,
          toppings: toppingsByParent.get(p.id) ?? [],
        })),
      } as Bill;
    });
  }

  // ── Don app (app_orders) ──
  private async loadAppBills(
    limit: number,
    from?: string,
    to?: string,
  ): Promise<Bill[]> {
    const rows = await this.db.query<{
      order_code: string;
      fulfillment: string | null;
      payment_method: string | null;
      payment_status: string | null;
      prep_status: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      items: any;
      total_amount: string | null;
      received_at: Date | null;
      paid_at: Date | null;
    }>(
      `SELECT order_code, fulfillment, payment_method, payment_status,
              prep_status, customer_name, customer_phone, items, total_amount,
              received_at, paid_at
         FROM app_orders
        ${from && to ? 'WHERE received_at >= $2 AND received_at < $3' : ''}
        ORDER BY received_at DESC
        LIMIT $1`,
      from && to ? [limit, from, to] : [limit],
    );

    return rows.map((a) => {
      const rawItems = Array.isArray(a.items) ? a.items : [];
      return {
        source: 'APP',
        code: a.order_code,
        createdAt: (a.paid_at ?? a.received_at)?.toISOString() ?? null,
        paymentMethod: a.payment_method,
        paymentStatus: a.payment_status,
        prepStatus: a.prep_status,
        fulfillment: a.fulfillment,
        total: Number(a.total_amount ?? 0),
        tableNumber: null,
        customer: a.customer_name
          ? { name: a.customer_name, phone: a.customer_phone }
          : null,
        items: rawItems.map((it: any) => ({
          name: String(it?.name ?? ''),
          unitPrice: Number(it?.unitPrice ?? it?.unit_price ?? 0),
          quantity: Number(it?.quantity ?? 1),
          toppings: (Array.isArray(it?.options) ? it.options : []).map(
            (o: any) => ({
              name: String(o?.name ?? ''),
              unitPrice: Number(o?.price ?? o?.unitPrice ?? 0),
            }),
          ),
        })),
      } as Bill;
    });
  }
}