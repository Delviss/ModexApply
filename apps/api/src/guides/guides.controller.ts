import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  GUIDE_EVIDENCE_TYPES,
  GUIDE_TOPICS,
  PROGRAM_LEVELS,
  type AccessContext,
  type GuideTopic,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { GuidesService } from './guides.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

const RegisterSchema = z.object({
  institutionId: z.uuid(),
  campusId: z.uuid().nullable().optional(),
  programKey: z.string().max(200).nullable().optional(),
});

const ProfilePatchSchema = z.object({
  institutionId: z.uuid().optional(),
  campusId: z.uuid().nullable().optional(),
  programKey: z.string().max(200).nullable().optional(),
  level: z.enum(PROGRAM_LEVELS).nullable().optional(),
  yearOfStudy: z.number().int().min(1).max(10).nullable().optional(),
  languages: z.array(z.string().min(2).max(40)).max(10).optional(),
  homeCountry: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  topics: z.array(z.enum(GUIDE_TOPICS)).max(GUIDE_TOPICS.length).optional(),
  bio: z.string().max(1_000).nullable().optional(),
});

const EvidenceSchema = z.object({
  evidenceType: z.enum(GUIDE_EVIDENCE_TYPES),
  evidenceRef: z.string().max(500).nullable().optional(),
  summary: z.string().min(5).max(500),
});

const SlotSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  topics: z.array(z.enum(GUIDE_TOPICS)).optional(),
  capacity: z.number().int().min(1).max(20).optional(),
});

/**
 * The guide surfaces (Phase 3 §1–§2).
 *
 * Two things to notice in the route table:
 *
 *  - `/guides/me/*` is the guide's own record, and is the only place the private
 *    half of a guide is readable — by the guide, about themselves.
 *  - Verification and suspension live under `guide:verify` and `guide:suspend`,
 *    which no university role holds. A university approves its roster through
 *    the partnership scope; it does not verify its own guides, for the same
 *    reason it does not verify itself (Phase 1 §2).
 */
@Controller({ version: '1' })
export class GuidesController {
  constructor(
    private readonly guides: GuidesService,
    private readonly sessions: SessionsService,
  ) {}

  /** The directory. Ordering is `matchGuides`; the query filters, never ranks. */
  @Get('guides')
  @RequirePermissions('guide:read')
  async directory(
    @Query('institutionId') institutionId: string,
    @Query('campusId') campusId?: string,
    @Query('programKey') programKey?: string,
    @Query('discipline') discipline?: string,
    @Query('languages') languages?: string,
    @Query('topics') topics?: string,
    @Query('homeCountry') homeCountry?: string,
    @Query('forSession') forSession?: string,
  ) {
    const matches = await this.guides.directory({
      institutionId,
      campusId: campusId ?? null,
      campusSpecific: campusId !== undefined,
      programKey: programKey ?? null,
      discipline: discipline ?? null,
      languages: splitList(languages),
      topics: parseTopics(topics),
      homeCountry: homeCountry ?? null,
      requiresAvailability: forSession === 'true',
    });

    return {
      data: matches.map((match) => ({
        guide: match.profile,
        matchReason: match.matchReason,
        // The arithmetic travels with the result. "Why is this third?" has an
        // answer that does not require reading the source.
        factors: match.factors,
      })),
    };
  }

  @Get('guides/me/dashboard')
  @RequirePermissions('guide:write')
  async dashboard(@Actor() access: AccessContext) {
    return this.guides.dashboard(access);
  }

  @Post('guides')
  @RequirePermissions('guide:write')
  async register(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>,
  ) {
    return this.guides.register(access, body);
  }

  @Patch('guides/me')
  @RequirePermissions('guide:write')
  async patch(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ProfilePatchSchema)) body: z.infer<typeof ProfilePatchSchema>,
  ) {
    return this.guides.updateProfile(access, body);
  }

  @Post('guides/me/evidence')
  @RequirePermissions('guide:write')
  async submitEvidence(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(EvidenceSchema)) body: z.infer<typeof EvidenceSchema>,
  ) {
    return this.guides.submitEvidence(access, body);
  }

  @Post('guides/me/email-challenge')
  @RequirePermissions('guide:write')
  async issueChallenge(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(z.object({ email: z.email() })))
    body: { email: string },
  ) {
    const challenge = await this.guides.issueEmailChallenge(access, body.email);
    // The token is handed to the notification worker, not to the caller. What
    // comes back says a challenge exists and when it lapses.
    return { id: challenge.id, expiresAt: challenge.expiresAt };
  }

  @Post('guides/me/email-challenge/:id/confirm')
  @RequirePermissions('guide:write')
  async confirmChallenge(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ token: z.string().min(10) })))
    body: { token: string },
  ) {
    return this.guides.confirmEmailChallenge(access, id, body.token);
  }

  @Get('guides/:id')
  @RequirePermissions('guide:read')
  async profile(@Param('id') id: string) {
    return { guide: await this.guides.publicProfile(id) };
  }

  @Get('guides/:id/availability')
  @RequirePermissions('guide:read')
  async availability(@Param('id') id: string) {
    // Reading availability confirms the guide is discoverable first, so a
    // suspended guide's calendar is not a side channel around the directory.
    await this.guides.publicProfile(id);
    return { data: await this.sessions.availability(id) };
  }

  @Post('guides/me/availability')
  @RequirePermissions('session:manage')
  async addSlot(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(SlotSchema)) body: z.infer<typeof SlotSchema>,
  ) {
    return this.sessions.addSlot(access, body);
  }

  @Delete('guides/me/availability/:slotId')
  @RequirePermissions('session:manage')
  async removeSlot(@Actor() access: AccessContext, @Param('slotId') slotId: string) {
    return this.sessions.removeSlot(access, slotId);
  }

  @Post('guides/:id/verify')
  @RequirePermissions('guide:verify')
  async verify(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.guides.verify(access, id);
  }

  @Post('guides/:id/suspend')
  @RequirePermissions('guide:suspend')
  async suspend(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ reason: z.string().min(5).max(500) })))
    body: { reason: string },
  ) {
    return this.guides.suspend(toAuditActor(access), id, body.reason);
  }
}

/**
 * Unknown topic names are dropped rather than rejected: a stale bookmark with a
 * topic we have since renamed should still show the directory, not an error.
 */
function parseTopics(value: string | undefined): GuideTopic[] {
  return splitList(value).filter((entry): entry is GuideTopic =>
    (GUIDE_TOPICS as readonly string[]).includes(entry),
  );
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
