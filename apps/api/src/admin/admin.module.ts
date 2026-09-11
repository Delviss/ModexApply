import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { GuidesModule } from '../guides/guides.module.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { ConsoleController } from './console.controller.js';
import { UniversityPortalController } from './university-portal.controller.js';
import { UniversityPortalService } from './university-portal.service.js';
import { TrustConsoleController } from './trust-console.controller.js';
import { TrustConsoleService } from './trust-console.service.js';
import { OpsConsoleController } from './ops-console.controller.js';
import { OpsConsoleService } from './ops-console.service.js';
import { FinanceConsoleController } from './finance-console.controller.js';
import { FinanceConsoleService } from './finance-console.service.js';
import { SanctionsService } from './sanctions.service.js';
import { ImpersonationService } from './impersonation.service.js';

/**
 * The four consoles (Phase 6, #8).
 *
 * One module rather than four, because they share the shell, the step-up
 * mechanism and the impersonation banner — and because four modules would
 * invite four slightly different answers to "how do we scope this to an
 * organisation".
 */
@Module({
  imports: [AuditModule, GuidesModule, ApplicationsModule],
  controllers: [
    ConsoleController,
    UniversityPortalController,
    TrustConsoleController,
    OpsConsoleController,
    FinanceConsoleController,
  ],
  providers: [
    UniversityPortalService,
    TrustConsoleService,
    OpsConsoleService,
    FinanceConsoleService,
    SanctionsService,
    ImpersonationService,
  ],
  exports: [SanctionsService, ImpersonationService],
})
export class AdminModule {}
