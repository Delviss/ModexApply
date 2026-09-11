import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EligibilityModule } from '../eligibility/eligibility.module.js';
import { TrustModule } from '../trust/trust.module.js';
import { SearchModule } from '../search/search.module.js';
import { OffersController } from './offers.controller.js';
import { OffersService } from './offers.service.js';
import { OfferPricingService } from './offer-pricing.service.js';
import { OfferExpiryService } from './offer-expiry.service.js';
import { OfferIntegrityService } from './offer-integrity.service.js';
import { OfferLifecycleService } from './offer-lifecycle.service.js';

/**
 * Offers (Phase 5).
 *
 * Depends on eligibility (one rule engine), trust (a mismatch is an incident)
 * and search (a lapsed offer leaves the index in the same cycle it leaves the
 * catalogue). It depends on **neither** applications nor connectors, which is
 * what lets `ConnectorsModule` import this one to realise savings at enrolment
 * without a cycle or a `forwardRef`.
 */
@Module({
  imports: [AuditModule, EligibilityModule, TrustModule, SearchModule],
  controllers: [OffersController],
  providers: [
    OffersService,
    OfferPricingService,
    OfferExpiryService,
    OfferIntegrityService,
    OfferLifecycleService,
  ],
  exports: [
    OffersService,
    OfferPricingService,
    OfferExpiryService,
    OfferIntegrityService,
    OfferLifecycleService,
  ],
})
export class OffersModule {}
