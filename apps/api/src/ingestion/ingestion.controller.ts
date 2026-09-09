import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AccessContext } from '@modex/contracts';
import { IngestionService } from './ingestion.service.js';
import { FreshnessService } from './freshness.service.js';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';

const DryRunSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileRef: z.string().min(1).max(500),
  /** CSV text. Uploaded to object storage first; this is the parsed copy. */
  content: z.string().min(1).max(5_000_000),
});

@Controller({ version: '1' })
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly freshness: FreshnessService,
  ) {}

  /** Produces the reviewable diff. Changes nothing. */
  @Post('institutions/:institutionId/imports/dry-run')
  @RequirePermissions('catalogue:import')
  async dryRun(
    @Actor() access: AccessContext,
    @Param('institutionId') institutionId: string,
    @Body(new ZodValidationPipe(DryRunSchema)) body: z.infer<typeof DryRunSchema>,
  ) {
    return this.ingestion.dryRun(access, institutionId, body);
  }

  /** Applies exactly the diff the reviewer was shown. */
  @Post('imports/:importId/commit')
  @RequirePermissions('catalogue:import')
  async commit(@Actor() access: AccessContext, @Param('importId') importId: string) {
    return this.ingestion.commit(access, importId);
  }

  /** Manual trigger for the freshness sweep. Also runs on a schedule. */
  @Post('catalogue/freshness-sweep')
  @RequirePermissions('catalogue:sync')
  async sweep() {
    return this.freshness.sweep();
  }
}
