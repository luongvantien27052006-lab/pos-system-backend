// ============================================================
//  POS BACKEND  src/orders/session-cleanup.service.ts
//  >> FILE MỚI — dọn phiên quầy/bàn "treo" (UNPAID/PENDING_CASH bỏ dở).
// ============================================================
//
//  Vì sao: phiên khách quét bàn thêm món rồi bỏ đi, hoặc chọn tiền mặt rồi
//  "quay xe", KHÔNG có gì dọn -> bàn kẹt OCCUPIED + cảnh báo "đòi tiền mặt"
//  ghim mãi trên POS. Service này định kỳ xoá phiên rác quá hạn + trả bàn EMPTY.
//
//  An toàn: chỉ đụng phiên CHƯA THANH TOÁN (không có doanh thu) quá STALE_HOURS.
//  Xoá hẳn (item + phiên) để không phụ thuộc enum trạng thái. Tắt bằng
//  SESSION_CLEANUP_ENABLED=false nếu cần.

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private timer?: NodeJS.Timeout;

  // Phiên UNPAID/PENDING_CASH cũ hơn ngần này (giờ) coi là bỏ dở -> dọn.
  private static readonly STALE_HOURS = 6;
  private static readonly EVERY_MS = 10 * 60 * 1000; // 10 phút/lần

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    if (process.env.SESSION_CLEANUP_ENABLED === 'false') return;
    this.timer = setInterval(
      () => void this.sweep(),
      SessionCleanupService.EVERY_MS,
    );
    // Chạy 1 lần sau 30s để dọn ngay khi khởi động.
    setTimeout(() => void this.sweep(), 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      const result = await this.db.transaction(async (client) => {
        const stale = await client.query<{
          id: number;
          table_id: number | null;
        }>(
          `SELECT id, table_id FROM order_sessions
            WHERE status IN ('UNPAID','PENDING_CASH')
              AND created_at < NOW() - INTERVAL '${SessionCleanupService.STALE_HOURS} hours'
            FOR UPDATE`,
        );
        if (stale.rows.length === 0) return { sessions: 0, tables: 0 };

        const ids = stale.rows.map((r) => r.id);
        const tableIds = [
          ...new Set(
            stale.rows
              .map((r) => r.table_id)
              .filter((x): x is number => x != null),
          ),
        ];

        // Xoá item của các phiên rồi xoá phiên.
        await client.query(`DELETE FROM order_items WHERE session_id = ANY($1)`, [
          ids,
        ]);
        await client.query(`DELETE FROM order_sessions WHERE id = ANY($1)`, [
          ids,
        ]);

        // Trả bàn về EMPTY nếu không còn phiên mở nào khác.
        for (const t of tableIds) {
          const other = await client.query(
            `SELECT 1 FROM order_sessions
              WHERE table_id = $1 AND status IN ('UNPAID','PENDING_CASH') LIMIT 1`,
            [t],
          );
          if (other.rows.length === 0) {
            await client.query(
              `UPDATE tables SET status = 'EMPTY' WHERE id = $1`,
              [t],
            );
          }
        }
        return { sessions: ids.length, tables: tableIds.length };
      });

      if (result.sessions > 0) {
        this.logger.log(
          `Dọn phiên treo: xoá ${result.sessions} phiên, trả ${result.tables} bàn về EMPTY.`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Dọn phiên treo lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
