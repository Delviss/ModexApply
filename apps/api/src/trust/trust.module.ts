import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TrustController } from './trust.controller.js';
import { TrustService } from './trust.service.js';

@Module({
  imports: [AuditModule],
  controllers: [TrustController],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
