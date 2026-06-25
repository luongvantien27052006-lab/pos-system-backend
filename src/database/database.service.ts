import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';

/**
 * Lớp truy cập PostgreSQL dùng chung toàn hệ thống.
 * Bọc connection pool của `pg` và cung cấp 3 hàm tiện ích.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    // pg mặc định trả BIGINT (OID 20) về dạng CHUỖI để tránh mất chính xác.
    // ID trong hệ thống quán cà phê không bao giờ vượt Number.MAX_SAFE_INTEGER
    // (2^53) nên ép thẳng về number — để menu/giỏ hàng nhận id là số, khớp
    // với @IsInt() ở DTO và kiểu `number` ở frontend.
    types.setTypeParser(20, (val) => parseInt(val, 10));

    this.pool = new Pool({
      connectionString: this.config.get<string>('DATABASE_URL'),
      max: Number(this.config.get('PGPOOL_MAX') ?? 10),
    });
    this.pool.on('error', (err) =>
      this.logger.error('Lỗi pool PostgreSQL', err),
    );
    this.logger.log('Đã khởi tạo pool kết nối PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  /** Truy vấn trả về danh sách bản ghi. */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query<T>(text, params);
    return res.rows;
  }

  /** Truy vấn trả về đúng 1 bản ghi (hoặc null nếu không có). */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Chạy một transaction. Tự BEGIN / COMMIT / ROLLBACK.
   * Dùng cho thao tác cần tính nguyên tử — ví dụ chốt PAID ở Phần 2.4:
   * khóa phiên (SELECT ... FOR UPDATE), tính tổng món ACTIVE, rồi cập nhật
   * status + completed_at + total_amount trong cùng một giao dịch.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}