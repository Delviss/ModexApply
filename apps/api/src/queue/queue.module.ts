import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { loadEnv } from '../config/env.js';

@Global()
@Module({
  providers: [{ provide: QueueService, useFactory: () => new QueueService(loadEnv().REDIS_URL) }],
  exports: [QueueService],
})
export class QueueModule {}
