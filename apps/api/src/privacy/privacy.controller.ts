import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { ErasureRequestSchema, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { PrivacyService } from './privacy.service.js';

/**
 * The student's own data (Phase 7 §2).
 *
 * Every route is scoped to the caller and takes no id: there is no path here
 * that can address somebody else's data, because the safest version of an
 * access-request endpoint is one with nothing to enumerate.
 */
@Controller({ path: 'me/privacy', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** "Who has my data and why", in the student's own terms. */
  @Get()
  async overview(@Actor() access: AccessContext) {
    return this.privacy.overview(access);
  }

  /** Portability. Everything they gave us, as JSON they can take elsewhere. */
  @Post('export')
  async export(@Actor() access: AccessContext) {
    return this.privacy.export(access);
  }

  /**
   * Erasure, behind a typed confirmation.
   *
   * The response says what was deleted, what was anonymised and what was kept
   * under which obligation — the same list the page showed before they
   * confirmed.
   */
  @Post('erasure')
  async erase(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ErasureRequestSchema)) body: z.infer<typeof ErasureRequestSchema>,
  ) {
    return this.privacy.erase(access, body.reason);
  }
}
