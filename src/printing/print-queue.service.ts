// ============================================================
//  POS BACKEND  src/printing/print-queue.service.ts
//  >> CHEP DE (them health(): phat hien agent chet)
// ============================================================

// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/printing/print-queue.service.ts
//  >> FILE MOI — hang doi lenh in cho agent tai quan
// ==================================================================

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface PrintJobRow {
  id: string;
  target: string;
  payload: string;
}

@Injectable()
export class PrintQueueService {
  constructor(private readonly db: DatabaseService) {}

  /** Xếp 1 lệnh in vào hàng đợi (payload = ESC/POS base64). */
  async enqueue(target: string, data: Buffer): Promise<void> {
    await this.db.query(
      `INSERT INTO print_jobs (target, payload) VALUES ($1, $2)`,
      [target, data.toString('base64')],
    );
  }

  /** Agent kéo job: nhả lại job 'processing' quá 2 phút rồi nhận job pending. */
  async pull(limit = 10): Promise<PrintJobRow[]> {
    await this.db.query(
      `UPDATE print_jobs SET status = 'pending'
         WHERE status = 'processing' AND claimed_at < now() - interval '2 minutes'`,
    );
    const rows = await this.db.query<PrintJobRow>(
      `UPDATE print_jobs
          SET status = 'processing', claimed_at = now(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM print_jobs
           WHERE status = 'pending'
           ORDER BY id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id::text AS id, target, payload`,
      [limit],
    );
    return rows;
  }

  /**
   * Sức khoẻ hàng đợi in: agent còn sống không, có bill nào đang kẹt không.
   *  - lastPrintedAt: lần cuối agent in xong 1 job.
   *  - stuckCount: số job chờ quá 2 phút (agent tắt / mất mạng / sai IP).
   */
  async health(): Promise<{
    pending: number;
    stuckCount: number;
    lastPrintedAt: string | null;
    agentAlive: boolean;
  }> {
    const rows = await this.db.query<{
      pending: string;
      stuck: string;
      last_printed_at: Date | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('pending','processing'))         AS pending,
         COUNT(*) FILTER (WHERE status IN ('pending','processing')
                            AND created_at < now() - interval '2 minutes')  AS stuck,
         MAX(printed_at)                                                    AS last_printed_at
       FROM print_jobs`,
    );
    const r = rows[0];
    const pending = Number(r?.pending ?? 0);
    const stuckCount = Number(r?.stuck ?? 0);
    const lastPrintedAt = r?.last_printed_at
      ? new Date(r.last_printed_at).toISOString()
      : null;
    return { pending, stuckCount, lastPrintedAt, agentAlive: stuckCount === 0 };
  }

  /** Agent báo đã in xong -> đánh dấu done. */
  async ack(ids: string[]): Promise<void> {
    const clean = ids.filter((x) => /^\d+$/.test(String(x)));
    if (clean.length === 0) return;
    await this.db.query(
      `UPDATE print_jobs SET status = 'done', printed_at = now()
         WHERE id = ANY($1::bigint[])`,
      [clean],
    );
  }
}