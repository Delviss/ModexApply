import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EligibilityService } from './eligibility.service.js';
import { EligibilityController } from './eligibility.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [EligibilityController],
  providers: [EligibilityService],
  exports: [EligibilityService],
})
export class EligibilityModule {}
