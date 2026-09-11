import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  APPLICATION_STATES,
  RequirementReviewSchema,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { UniversityPortalService } from './university-portal.service.js';

const StateUpdateSchema = z.object({
  state: z.enum(APPLICATION_STATES),
  note: z.string().trim().max(2_000).optional(),
});

const EndorsementSchema = z.object({ endorsed: z.boolean() });
const RoleSchema = z.object({ role: z.enum(['university_admin', 'university_staff']) });

/**
 * The partner's own workspace (FR-017).
 *
 * `institutionId` is a query parameter rather than a path segment, and it is
 * ignored for anyone who has an organisation of their own: a university staff
 * account cannot address another institution by changing a URL, and a Modex
 * operator who legitimately needs to has to say which one, on the record.
 */
@Controller({ path: 'admin/university', version: '1' })
export class UniversityPortalController {
  constructor(private readonly portal: UniversityPortalService) {}

  @Get('dashboard')
  @RequirePermissions('application:read')
  @RequireStepUp('console_entry')
  async dashboard(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    return this.portal.dashboard(access, institutionId);
  }

  @Get('applications')
  @RequirePermissions('application:read')
  @RequireStepUp('console_entry')
  async applications(
    @Actor() access: AccessContext,
    @Query('state') state?: string,
    @Query('institutionId') institutionId?: string,
  ) {
    return {
      data: await this.portal.applications(access, {
        state: state === undefined ? undefined : z.enum(APPLICATION_STATES).parse(state),
        institutionId,
      }),
    };
  }

  @Post('applications/:id/state')
  @RequirePermissions('application:read')
  @RequireStepUp('console_entry')
  async updateState(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StateUpdateSchema)) body: z.infer<typeof StateUpdateSchema>,
  ) {
    return this.portal.updateApplicationState(access, id, body.state, body.note);
  }

  @Get('programmes')
  @RequirePermissions('program:read')
  @RequireStepUp('console_entry')
  async programmes(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    return { data: await this.portal.programmes(access, institutionId) };
  }

  @Get('programmes/:id/requirements')
  @RequirePermissions('program:read')
  @RequireStepUp('console_entry')
  async requirements(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.portal.requirements(access, id);
  }

  @Post('requirements/:id/review')
  @RequirePermissions('requirement:review')
  @RequireStepUp('console_entry')
  async review(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RequirementReviewSchema)) body: z.infer<typeof RequirementReviewSchema>,
  ) {
    return this.portal.reviewRequirement(access, id, body);
  }

  @Get('guides')
  @RequirePermissions('guide:read')
  @RequireStepUp('console_entry')
  async guides(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    return { data: await this.portal.guides(access, institutionId) };
  }

  @Post('guides/:id/endorsement')
  @RequirePermissions('guide:read')
  @RequireStepUp('console_entry')
  async endorse(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EndorsementSchema)) body: z.infer<typeof EndorsementSchema>,
  ) {
    return this.portal.setGuideEndorsement(access, id, body.endorsed);
  }

  @Get('analytics')
  @RequirePermissions('analytics:read')
  @RequireStepUp('console_entry')
  async analytics(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    return this.portal.analytics(access, institutionId);
  }

  /** User management is the admin/staff dividing line — `org_user:manage`. */
  @Get('staff')
  @RequirePermissions('org_user:manage')
  @RequireStepUp('console_entry')
  async staff(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    return { data: await this.portal.staff(access, institutionId) };
  }

  @Post('staff/:id/role')
  @RequirePermissions('org_user:manage')
  @RequireStepUp('console_entry')
  async setRole(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RoleSchema)) body: z.infer<typeof RoleSchema>,
  ) {
    return this.portal.setStaffRole(access, id, body.role);
  }
}
