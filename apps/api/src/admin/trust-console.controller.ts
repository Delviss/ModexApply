import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  SANCTION_TARGET_TYPES,
  SanctionReversalSchema,
  SanctionSchema,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { TrustConsoleService } from './trust-console.service.js';
import { SanctionsService } from './sanctions.service.js';

/**
 * The Trust console (Phase 6 §2).
 *
 * Two decorators do the work on every route, and the split between them is the
 * point: `@RequirePermissions` asks whether this person may ever do this, and
 * `@RequireStepUp` asks whether they proved it was them in the last fifteen
 * minutes. Evidence and sanctions need both.
 */
@Controller({ path: 'admin/trust', version: '1' })
export class TrustConsoleController {
  constructor(
    private readonly console: TrustConsoleService,
    private readonly sanctions: SanctionsService,
  ) {}

  @Get('summary')
  @RequirePermissions('trust_case:read')
  @RequireStepUp('console_entry')
  async summary() {
    return this.console.summary();
  }

  @Get('queue')
  @RequirePermissions('trust_case:read')
  @RequireStepUp('console_entry')
  async queue() {
    return this.console.verificationQueue();
  }

  @Get('signals')
  @RequirePermissions('trust_case:read')
  @RequireStepUp('console_entry')
  async signals(@Query('days') days?: string) {
    const window = Math.min(Math.max(Number.parseInt(days ?? '7', 10) || 7, 1), 90);
    return this.console.riskSignals(new Date(Date.now() - window * 86_400_000));
  }

  /** Viewing evidence is itself an audited action, and needs its own step-up. */
  @Get('institutions/:id/evidence')
  @RequirePermissions('evidence:read')
  @RequireStepUp('evidence_view')
  async institutionEvidence(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.console.evidenceFor(access, id);
  }

  @Get('guides/:id/evidence')
  @RequirePermissions('evidence:read')
  @RequireStepUp('evidence_view')
  async guideEvidence(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.console.guideEvidenceFor(access, id);
  }

  @Get('sanctions')
  @RequirePermissions('trust_case:read')
  @RequireStepUp('console_entry')
  async listSanctions(@Query('targetType') targetType?: string, @Query('active') active?: string) {
    return {
      data: await this.sanctions.list({
        targetType:
          targetType === undefined ? undefined : z.enum(SANCTION_TARGET_TYPES).parse(targetType),
        active: active === 'true',
      }),
    };
  }

  @Post('sanctions')
  @RequirePermissions('sanction:write')
  @RequireStepUp('sanction')
  async applySanction(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(SanctionSchema)) body: z.infer<typeof SanctionSchema>,
  ) {
    return this.sanctions.apply(access, body);
  }

  /**
   * Lifting one. Also behind step-up: reinstating a banned account is as
   * consequential as banning it, and an unattended console should not be able
   * to do either.
   */
  @Post('sanctions/:id/reverse')
  @RequirePermissions('sanction:write')
  @RequireStepUp('sanction')
  async reverseSanction(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SanctionReversalSchema)) body: z.infer<typeof SanctionReversalSchema>,
  ) {
    return this.sanctions.reverse(access, id, body.reason);
  }
}
