import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AccessContext } from '@modex/contracts';
import { Public } from '../auth/decorators/access.decorators.js';
import { OptionalActor } from '../auth/decorators/actor.decorator.js';
import { EligibilityService } from './eligibility.service.js';

/**
 * Eligibility explanations (Phase 2 §4, FR-005).
 *
 * Public, and deliberately so: an anonymous visitor sees the requirements
 * evaluated as far as they can be, which is every row reading `missing_data`
 * with a remedy. Refusing to answer at all would teach students that the
 * requirements are secret until they sign up.
 */
@Controller({ version: '1' })
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Get('programmes/:programKey/eligibility')
  @Public()
  async explain(
    @OptionalActor() access: AccessContext | null,
    @Param('programKey') programKey: string,
  ) {
    return this.eligibility.explain(programKey, access?.userId ?? null);
  }

  /** Batch, for the compare view: one profile load rather than four. */
  @Get('eligibility')
  @Public()
  async explainMany(
    @OptionalActor() access: AccessContext | null,
    @Query('programKeys') programKeys?: string,
  ) {
    const keys = (programKeys ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    const explanations = await this.eligibility.explainMany(keys, access?.userId ?? null);
    return { data: Object.fromEntries(explanations) };
  }
}
