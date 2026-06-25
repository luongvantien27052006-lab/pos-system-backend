import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/** @Global: các module nghiệp vụ inject RealtimeGateway để phát sự kiện. */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}