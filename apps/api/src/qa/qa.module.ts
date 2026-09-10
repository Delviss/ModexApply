import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { GuidesModule } from '../guides/guides.module.js';
import { QaController } from './qa.controller.js';
import { QaService } from './qa.service.js';

@Module({
  imports: [AuditModule, GuidesModule],
  controllers: [QaController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
