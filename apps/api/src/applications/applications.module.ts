import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { EligibilityModule } from '../eligibility/eligibility.module.js';
import { ConnectorCoreModule } from '../connectors/connector-core.module.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicationStateService } from './application-state.service.js';
import { PayloadBuilderService } from './payload-builder.service.js';
import { SubmissionService } from './submission.service.js';

@Module({
  imports: [AuditModule, DocumentsModule, StorageModule, EligibilityModule, ConnectorCoreModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    ApplicationStateService,
    PayloadBuilderService,
    SubmissionService,
    IdempotencyService,
  ],
  exports: [ApplicationsService, ApplicationStateService, PayloadBuilderService, SubmissionService],
})
export class ApplicationsModule {}
