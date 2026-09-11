import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  ImpersonationRequestSchema,
  NotificationTemplateSchema,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { OpsConsoleService } from './ops-console.service.js';
import { ImpersonationService } from './impersonation.service.js';

const EnabledSchema = z.object({ enabled: z.boolean() });
const EndImpersonationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** The operations console (Phase 6 §3). */
@Controller({ path: 'admin/ops', version: '1' })
export class OpsConsoleController {
  constructor(
    private readonly ops: OpsConsoleService,
    private readonly impersonation: ImpersonationService,
  ) {}

  @Get('catalogue')
  @RequirePermissions('catalogue:sync')
  @RequireStepUp('console_entry')
  async catalogue() {
    return this.ops.catalogueHealth();
  }

  @Get('connectors')
  @RequirePermissions('connector:read')
  @RequireStepUp('console_entry')
  async connectors() {
    return { data: await this.ops.connectorHealth() };
  }

  @Post('connectors/:id/enabled')
  @RequirePermissions('connector:manage')
  @RequireStepUp('console_entry')
  async setConnector(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EnabledSchema)) body: z.infer<typeof EnabledSchema>,
  ) {
    return this.ops.setConnectorEnabled(access, id, body.enabled);
  }

  @Get('exceptions')
  @RequirePermissions('application:read')
  @RequireStepUp('console_entry')
  async exceptions() {
    return this.ops.exceptions();
  }

  @Get('notifications/templates')
  @RequirePermissions('notification:write')
  @RequireStepUp('console_entry')
  async templates() {
    return { data: await this.ops.templates() };
  }

  @Post('notifications/templates')
  @RequirePermissions('notification:write')
  @RequireStepUp('console_entry')
  async upsertTemplate(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(NotificationTemplateSchema))
    body: z.infer<typeof NotificationTemplateSchema>,
  ) {
    return this.ops.upsertTemplate(access, body);
  }

  @Get('notifications/health')
  @RequirePermissions('notification:write')
  @RequireStepUp('console_entry')
  async deliveryHealth() {
    return this.ops.deliveryHealth();
  }

  // -------------------------------------------------------------------------
  // Support impersonation
  // -------------------------------------------------------------------------

  @Get('impersonations')
  @RequirePermissions('user:impersonate')
  @RequireStepUp('console_entry')
  async activeImpersonations() {
    return { data: await this.impersonation.active() };
  }

  /**
   * Starting one needs its own step-up, separate from console entry: it is the
   * single most invasive thing an operator can do, and it should never be
   * something a walked-away-from laptop can do on their behalf.
   */
  @Post('impersonations')
  @RequirePermissions('user:impersonate')
  @RequireStepUp('impersonation')
  async startImpersonation(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ImpersonationRequestSchema))
    body: z.infer<typeof ImpersonationRequestSchema>,
  ) {
    return this.impersonation.start(access, body);
  }

  /**
   * Ending one needs no step-up. Making it harder to stop impersonating than to
   * start would be exactly the wrong way round.
   */
  @Post('impersonations/:id/end')
  @RequirePermissions('user:impersonate')
  async endImpersonation(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EndImpersonationSchema)) body: z.infer<typeof EndImpersonationSchema>,
  ) {
    return this.impersonation.end(access, id, body.reason ?? 'ended_by_operator');
  }
}
