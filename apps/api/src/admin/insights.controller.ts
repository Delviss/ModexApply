import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { INSIGHT_WINDOWS, InsightsService } from './insights.service.js';

/**
 * Statistics and insights (Phase 8, #20).
 *
 * `analytics:read`, which university staff, university admins and ops already
 * hold. Trust and finance do not: an aggregate over applications is not part of
 * either job, and a console everybody can open is a console nobody had to be
 * granted.
 *
 * The window is an enum rather than a free date range. A caller who can name
 * any window can name the one containing a single applicant, and a "cohort of
 * one" is a disclosure dressed as a statistic.
 */
const OverviewQuerySchema = z.object({
  window: z.coerce
    .number()
    .refine((value): value is (typeof INSIGHT_WINDOWS)[number] =>
      (INSIGHT_WINDOWS as readonly number[]).includes(value),
    )
    .default(30),
  institutionId: z.string().nullable().default(null),
});

@Controller({ path: 'admin/insights', version: '1' })
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  @RequirePermissions('analytics:read')
  @RequireStepUp('console_entry')
  async overview(
    @Actor() access: AccessContext,
    @Query(new ZodValidationPipe(OverviewQuerySchema)) query: z.infer<typeof OverviewQuerySchema>,
  ) {
    return this.insights.overview(access, {
      window: query.window,
      institutionId: query.institutionId,
    });
  }
}
