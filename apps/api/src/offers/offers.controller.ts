import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ADMISSION_OFFER_KINDS,
  OFFER_BASES,
  OFFER_DURATIONS,
  OFFER_TYPES,
  OfferConditionSchema,
  OfferExclusionSchema,
  OfferValueSchema,
  type AccessContext,
} from '@modex/contracts';
import { Actor, OptionalActor } from '../auth/decorators/actor.decorator.js';
import { Public, RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { OffersService } from './offers.service.js';
import { OfferPricingService } from './offer-pricing.service.js';
import { OfferExpiryService } from './offer-expiry.service.js';
import { OfferIntegrityService } from './offer-integrity.service.js';
import { OfferLifecycleService } from './offer-lifecycle.service.js';

const DraftSchema = z.object({
  offerKey: z.string().min(1).max(120),
  institutionId: z.uuid(),
  programKey: z.string().min(1).nullable().default(null),
  type: z.enum(OFFER_TYPES),
  name: z.string().min(3).max(200),
  value: OfferValueSchema,
  appliesTo: z.enum(OFFER_BASES),
  duration: z.enum(OFFER_DURATIONS).default('first_year'),
  conditions: z.array(OfferConditionSchema).default([]),
  exclusions: z.array(OfferExclusionSchema).default([]),
  termsSummary: z.string().min(1).nullable().default(null),
  applicationMethod: z.string().min(1).nullable().default(null),
  redemptionMethod: z.string().min(1).nullable().default(null),
  claimDeadline: z.iso.datetime().nullable().default(null),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  sourceRef: z.string().min(1).nullable().default(null),
});

const EditSchema = DraftSchema.partial().omit({ offerKey: true, institutionId: true });

const VerifySchema = z.object({
  verified: z.boolean(),
  verifierName: z.string().min(2).max(120),
  note: z.string().max(500).optional(),
});

const SourceCheckSchema = z.object({
  sourceRef: z.string().min(1),
  matched: z.boolean(),
  checkedBy: z.string().min(2).max(120),
  observed: z
    .object({
      value: OfferValueSchema.optional(),
      validUntil: z.iso.datetime().optional(),
      note: z.string().max(1000).optional(),
    })
    .default({}),
});

const AttachSchema = z.object({ offerKey: z.string().min(1) });
const RespondSchema = z.object({ decision: z.enum(['accepted', 'declined']) });

const AdmissionSchema = z.object({
  kind: z.enum(ADMISSION_OFFER_KINDS),
  conditions: z
    .array(
      z.object({
        summary: z.string().min(3),
        met: z.boolean(),
        evidence: z.string().nullable().default(null),
      }),
    )
    .default([]),
  issuedAt: z.iso.datetime(),
  respondByAt: z.iso.datetime().nullable().default(null),
  externalRef: z.string().nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

/**
 * Offers (Phase 5, FR-013 and FR-014).
 *
 * The permission split is the whole trust story of this phase in five routes:
 * a university drafts and publishes with `offer:write`, but **only Trust can
 * verify** with `offer:verify`, and `publish` refuses anything unverified. There
 * is no route here through which a partner can make their own discount official.
 */
@Controller({ version: '1' })
export class OffersController {
  constructor(
    private readonly offers: OffersService,
    private readonly pricing: OfferPricingService,
    private readonly expiry: OfferExpiryService,
    private readonly integrity: OfferIntegrityService,
    private readonly lifecycle: OfferLifecycleService,
  ) {}

  /**
   * The price panel. Public, because the catalogue is public — an anonymous
   * reader sees the gross price and every offer with its conditions unassessed,
   * which is the honest version of "you might qualify for this".
   */
  @Get('programmes/:programKey/price')
  @Public()
  async price(
    @OptionalActor() access: AccessContext | null,
    @Param('programKey') programKey: string,
  ) {
    return this.pricing.priceProgramme(programKey, access?.userId ?? null);
  }

  @Get('institutions/:institutionId/offers')
  @RequirePermissions('offer:read')
  async listForInstitution(
    @Actor() access: AccessContext,
    @Param('institutionId') institutionId: string,
  ) {
    return { data: await this.offers.listForInstitution(access, institutionId) };
  }

  @Post('offers')
  @RequirePermissions('offer:write')
  async createDraft(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(DraftSchema)) body: z.infer<typeof DraftSchema>,
  ) {
    const { offerKey, ...input } = body;
    return this.offers.createDraft(access, offerKey, input);
  }

  @Post('offers/:offerKey/versions')
  @RequirePermissions('offer:write')
  async supersede(
    @Actor() access: AccessContext,
    @Param('offerKey') offerKey: string,
    @Body(new ZodValidationPipe(EditSchema)) body: z.infer<typeof EditSchema>,
  ) {
    return this.offers.supersede(access, offerKey, body);
  }

  /** Trust only. A university cannot sign off its own discount. */
  @Post('offers/:offerKey/verification')
  @RequirePermissions('offer:verify')
  async verify(
    @Actor() access: AccessContext,
    @Param('offerKey') offerKey: string,
    @Body(new ZodValidationPipe(VerifySchema)) body: z.infer<typeof VerifySchema>,
  ) {
    return this.offers.verify(access, offerKey, body);
  }

  @Post('offers/:offerKey/publish')
  @RequirePermissions('offer:write')
  async publish(@Actor() access: AccessContext, @Param('offerKey') offerKey: string) {
    return this.offers.publish(access, offerKey);
  }

  @Post('offers/:offerKey/unpublish')
  @RequirePermissions('offer:write')
  async unpublish(
    @Actor() access: AccessContext,
    @Param('offerKey') offerKey: string,
    @Body(new ZodValidationPipe(z.object({ reason: z.string().min(3).max(500) })))
    body: { reason: string },
  ) {
    const current = await this.offers.current(offerKey);
    const pulled = await this.offers.unpublish(toAuditActor(access), current.id, body.reason);
    return { offerKey, unpublished: pulled };
  }

  /**
   * A source re-check. A mismatch unpublishes the offer, opens a trust case and
   * notifies the partner — `offer:verify`, because deciding that what we display
   * differs from what the university says is a trust judgement.
   */
  @Post('offers/:offerKey/source-checks')
  @RequirePermissions('offer:verify')
  async sourceCheck(
    @Actor() access: AccessContext,
    @Param('offerKey') offerKey: string,
    @Body(new ZodValidationPipe(SourceCheckSchema)) body: z.infer<typeof SourceCheckSchema>,
  ) {
    return this.integrity.recordSourceCheck(access, { offerKey, ...body });
  }

  @Get('offers/due-recheck')
  @RequirePermissions('offer:verify')
  async dueForRecheck(@Actor() access: AccessContext, @Query('institutionId') institutionId?: string) {
    void access;
    return { data: await this.integrity.dueForRecheck(institutionId ?? null) };
  }

  /** On demand, for an operator. The schedule runs it without anyone asking. */
  @Post('offers/expiry-sweep')
  @RequirePermissions('offer:verify')
  async sweep(@Actor() access: AccessContext) {
    void access;
    return this.expiry.sweep();
  }

  // --- On an application ---------------------------------------------------

  @Get('applications/:id/offers')
  @RequirePermissions('application:read')
  async offersOnApplication(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.lifecycle.forApplication(access, id);
  }

  @Post('applications/:id/offers')
  @RequirePermissions('application:write')
  async attach(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AttachSchema)) body: z.infer<typeof AttachSchema>,
  ) {
    return this.lifecycle.attach(access, id, body.offerKey);
  }

  @Post('applications/:id/offers/:offerKey/respond')
  @RequirePermissions('application:write')
  async respond(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Param('offerKey') offerKey: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ) {
    return this.lifecycle.respond(access, id, offerKey, body.decision);
  }

  /**
   * The university records its admission decision.
   *
   * A separate route from everything above, with `application:read` plus the
   * organisation boundary rather than `offer:write`: this is not an offer in the
   * Phase 5 sense at all, and routing it through the same handler is exactly the
   * conflation the issue asks us not to make.
   */
  @Post('applications/:id/admission-offer')
  @RequirePermissions('application:read')
  async recordAdmissionOffer(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdmissionSchema)) body: z.infer<typeof AdmissionSchema>,
  ) {
    return this.lifecycle.recordAdmissionOffer(toAuditActor(access), id, body);
  }

  @Get('reports/savings')
  @RequirePermissions('offer:read')
  async savings(@Actor() access: AccessContext) {
    // A student sees their own; staff see their institution's. Nobody gets a
    // platform-wide figure from this route by accident.
    if (access.roles.includes('student')) {
      return this.lifecycle.savingsReport({ studentId: access.userId });
    }
    return this.lifecycle.savingsReport(
      access.organisationId === null ? {} : { institutionId: access.organisationId },
    );
  }
}
