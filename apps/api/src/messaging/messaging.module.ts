import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { GuidesModule } from '../guides/guides.module.js';
import { TrustModule } from '../trust/trust.module.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

@Module({
  imports: [AuditModule, GuidesModule, TrustModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
