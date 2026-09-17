// POS BACKEND  src/refunds/refunds.service.ts
// Gọi App backend (nguồn sự thật) + GHI LOG ĐỐI CHIẾU phía POS mỗi lần hoàn tiền.

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

@Injectable()
export class RefundsService {
  constructor(private readonly db: DatabaseService) {}

  private ready = false;
  private async ensureLog(): Promise<void> {
    if (this.ready) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS pos_refund_log (
        refund_id      TEXT PRIMARY KEY,
        order_id       TEXT,
        amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
        bank_account   TEXT,
        bank_name      TEXT,
        account_holder TEXT,
        completed_by   TEXT,
        requested_at   TIMESTAMPTZ,
        completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    this.ready = true;
  }

  async listPending(): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/pending', {
      headers: { 'x-internal-secret': SECRET },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async listCompleted(): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/completed', {
      headers: { 'x-internal-secret': SECRET },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async complete(
    refundId: string,
    completedBy?: string,
    note?: string,
  ): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ refundId, completedBy, note }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;

    // Ghi log ĐỐI CHIẾU phía POS (best-effort — không chặn nghiệp vụ).
    try {
      await this.ensureLog();
      await this.db.query(
        `INSERT INTO pos_refund_log
           (refund_id, order_id, amount, bank_account, bank_name,
            account_holder, completed_by, requested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (refund_id) DO NOTHING`,
        [
          (data?.id as string) ?? refundId,
          (data?.orderId as string) ?? null,
          (data?.amount as number) ?? 0,
          (data?.bankAccount as string) ?? null,
          (data?.bankName as string) ?? null,
          (data?.accountHolder as string) ?? null,
          completedBy ?? (data?.completedBy as string) ?? null,
          (data?.requestedAt as string) ?? null,
        ],
      );
    } catch {
      /* ghi log lỗi không chặn hoàn tiền */
    }
    return data;
  }

  async reject(
    refundId: string,
    reason: string,
    rejectedBy?: string,
  ): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ refundId, reason, completedBy: rejectedBy }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Log đối chiếu phía POS (để kiểm tra khớp với App). */
  async localLog(limit = 100): Promise<unknown> {
    await this.ensureLog();
    return this.db.query(
      `SELECT refund_id, order_id, amount, bank_account, bank_name,
              account_holder, completed_by, requested_at, completed_at
         FROM pos_refund_log
        ORDER BY completed_at DESC LIMIT $1`,
      [limit],
    );
  }

  /** ĐỐI CHIẾU 2 ĐẦU: hoàn tiền ĐÃ HOÀN ở App vs log POS -> tìm lệch. */
  async reconcile(): Promise<{
    matched: number;
    onlyApp: Record<string, unknown>[];
    onlyPos: Record<string, unknown>[];
  }> {
    const appListRaw = await this.listCompleted();
    const posLogRaw = await this.localLog(500);
    const app = (Array.isArray(appListRaw) ? appListRaw : []) as Record<
      string,
      unknown
    >[];
    const pos = (Array.isArray(posLogRaw) ? posLogRaw : []) as Record<
      string,
      unknown
    >[];
    const appCompleted = app.filter((r) => r.status === 'COMPLETED');
    const posIds = new Set(pos.map((r) => r.refund_id));
    const appIds = new Set(appCompleted.map((r) => r.id));
    const onlyApp = appCompleted.filter((r) => !posIds.has(r.id));
    const onlyPos = pos.filter((r) => !appIds.has(r.refund_id));
    return { matched: appCompleted.length - onlyApp.length, onlyApp, onlyPos };
  }
}
