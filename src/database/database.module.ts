import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/** @Global: mọi module khác inject DatabaseService mà không cần import lại. */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}