import { Controller, Get, Query } from '@nestjs/common';
import { ProgramSearchQuerySchema, type AccessContext } from '@modex/contracts';
import { OptionalActor } from '../auth/decorators/actor.decorator.js';
import { Public } from '../auth/decorators/access.decorators.js';
import { SearchService } from './search.service.js';

/**
 * Catalogue search (Phase 2 §3, FR-004).
 *
 * Public: a prospective student searches before they have an account, and
 * requiring one to look would be the first thing this platform does wrong. A
 * signed-in student gets the same results in an order informed by their
 * profile, and every factor that moved a row is returned alongside it.
 */
@Controller({ version: '1' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('programmes')
  @Public()
  async searchProgrammes(
    @OptionalActor() access: AccessContext | null,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    return this.search.search(parseQuery(rawQuery), access?.userId ?? null);
  }
}

/**
 * Query strings carry `country=GB&country=IE` or `country=GB,IE` depending on
 * the client. Both are normalised here so the schema sees arrays either way,
 * rather than a single-element filter silently arriving as a string.
 */
function parseQuery(raw: Record<string, unknown>): ReturnType<typeof ProgramSearchQuerySchema.parse> {
  const arrayFields = ['country', 'city', 'institutionId', 'level', 'discipline', 'intake', 'language'];
  const normalised: Record<string, unknown> = { ...raw };

  for (const field of arrayFields) {
    const value = raw[field];
    if (value === undefined) continue;
    normalised[field] = Array.isArray(value)
      ? value
      : String(value)
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
  }

  for (const field of [
    'tuitionMinMinor',
    'tuitionMaxMinor',
    'applicationFeeMaxMinor',
    'durationMaxMonths',
  ]) {
    const value = raw[field];
    normalised[field] = value === undefined || value === '' ? null : Number(value);
  }

  for (const field of ['scholarshipAvailable', 'discountAvailable']) {
    const value = raw[field];
    normalised[field] = value === undefined || value === '' ? null : value === 'true' || value === true;
  }

  return ProgramSearchQuerySchema.parse(normalised);
}
