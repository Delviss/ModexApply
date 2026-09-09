import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CursorQuerySchema,
  PARTNERSHIP_SCOPES,
  VERIFICATION_STAGES,
  encodeCursor,
  page,
  type AccessContext,
} from '@modex/contracts';
import { InstitutionsService } from './institutions.service.js';
import { DomainVerificationService } from './domain-verification.service.js';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { Public, RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { toAuditActor } from '../auth/audit-actor.js';

const CreateSchema = z.object({
  legalName: z.string().min(2).max(300),
  displayName: z.string().min(2).max(200),
  domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1).max(20),
  country: z.string().length(2),
  websiteUrl: z.url().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
});

const AdvanceSchema = z.object({
  targetStage: z.enum(VERIFICATION_STAGES),
  overrideJustification: z.string().max(2000).nullable().optional(),
});

const PartnershipSchema = z.object({
  scopes: z.array(z.enum(PARTNERSHIP_SCOPES)).optional(),
  contractRef: z.string().max(200).nullable().optional(),
  markets: z.array(z.string().length(2)).optional(),
});

const RevokeSchema = z.object({ reason: z.string().min(10).max(1000) });
const ChallengeSchema = z.object({
  domain: z.string(),
  method: z.enum(['dns_txt', 'email_on_domain']).default('dns_txt'),
});
const ContactSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.email(),
  role: z.enum(['authorised_signatory', 'admissions', 'international_office', 'technical', 'finance']),
  isAuthorisedSignatory: z.boolean().default(false),
});
const EvidenceSchema = z.object({
  stage: z.enum(VERIFICATION_STAGES),
  summary: z.string().min(10).max(2000),
  documentRef: z.string().max(300).nullable().optional(),
});

@Controller({ path: 'institutions', version: '1' })
export class InstitutionsController {
  constructor(
    private readonly institutions: InstitutionsService,
    private readonly domains: DomainVerificationService,
  ) {}

  /** Public institution page. Verification evidence is never in this payload. */
  @Public()
  @Get(':id/public')
  async publicProfile(@Param('id') id: string) {
    return this.institutions.findPublicBySlugOrId(id);
  }

  @Public()
  @Get()
  async list(@Query() query: Record<string, string>) {
    const parsed = CursorQuerySchema.parse(query);
    const rows = await this.institutions.list({
      ...(query.country === undefined ? {} : { country: query.country }),
      ...(query.verified === undefined ? {} : { verified: query.verified === 'true' }),
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
      limit: parsed.limit,
    });
    const hasMore = rows.length > parsed.limit;
    const data = hasMore ? rows.slice(0, parsed.limit) : rows;
    const last = data[data.length - 1];
    return page(data, hasMore && last !== undefined ? encodeCursor({ id: last.id }) : null);
  }

  @Get(':id')
  @RequirePermissions('institution:read')
  async findOne(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.institutions.findById(access, id);
  }

  @Post()
  @RequirePermissions('institution:write')
  async create(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ) {
    return this.institutions.create(access, body);
  }

  @Post(':id/domain-challenges')
  @RequirePermissions('institution:write')
  async issueChallenge(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChallengeSchema)) body: z.infer<typeof ChallengeSchema>,
  ) {
    return this.domains.issueChallenge(toAuditActor(access), id, body.domain, body.method);
  }

  @Post('domain-challenges/:challengeId/check')
  @RequirePermissions('institution:write')
  async checkChallenge(@Actor() access: AccessContext, @Param('challengeId') challengeId: string) {
    return this.domains.checkChallenge(toAuditActor(access), challengeId);
  }

  @Post(':id/contacts')
  @RequirePermissions('institution:write')
  async addContact(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ContactSchema)) body: z.infer<typeof ContactSchema>,
  ) {
    return this.institutions.addContact(access, id, body);
  }

  /** Trust-agent only: recording what was actually checked, and by whom. */
  @Post(':id/evidence')
  @RequirePermissions('institution:verify')
  async recordEvidence(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EvidenceSchema)) body: z.infer<typeof EvidenceSchema>,
  ) {
    return this.institutions.recordEvidence(access, id, body);
  }

  @Post(':id/verification/advance')
  @RequirePermissions('institution:read')
  async advance(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdvanceSchema)) body: z.infer<typeof AdvanceSchema>,
  ) {
    return this.institutions.advanceVerification(access, id, body.targetStage, {
      overrideJustification: body.overrideJustification ?? null,
    });
  }

  @Post(':id/partnership')
  @RequirePermissions('partnership:write')
  async updatePartnership(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PartnershipSchema)) body: z.infer<typeof PartnershipSchema>,
  ) {
    return this.institutions.updatePartnership(access, id, body);
  }

  @Post(':id/partnership/revoke')
  @RequirePermissions('partnership:revoke')
  async revoke(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RevokeSchema)) body: z.infer<typeof RevokeSchema>,
  ) {
    return this.institutions.revokePartnership(access, id, body.reason);
  }
}
