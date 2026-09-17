// POS BACKEND  src/refunds/refunds.service.ts  (FILE MỚI)
// Gọi App backend lấy danh sách yêu cầu hoàn tiền + đánh dấu đã hoàn.

import { Injectable } from '@nestjs/common';

const APP_URL = (process.env.APP_INTERNAL_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_SYNC_SECRET ?? '';

@Injectable()
export class RefundsService {
  async listPending(): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/pending', {
      headers: { 'x-internal-secret': SECRET },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async complete(refundId: string, note?: string): Promise<unknown> {
    const res = await fetch(APP_URL + '/internal/refunds/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ refundId, note }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`App ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
