import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/health — kiểm tra server + kết nối DB. */
  @Get('health')
  async health() {
    const row = await this.db.queryOne<{ now: Date }>('SELECT NOW() AS now');
    return { status: 'ok', db: row !== null, time: row?.now };
  }
}