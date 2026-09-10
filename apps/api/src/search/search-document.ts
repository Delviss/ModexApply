import { deriveIntakeStatus, publicVisibility, type SyncState } from '@modex/contracts';
import type { SearchDocument } from './search-index.port.js';

/**
 * Projects the authoritative catalogue tables into one denormalised search
 * document (Phase 2 §3).
 *
 * The visibility decision is made **here**, at build time, using the same
 * `publicVisibility` the public programme page uses. Storing the answer rather
 * than recomputing it per query means a query that forgets to filter still
 * cannot surface a programme the freshness sweeper pulled — the row simply is
 * not visible.
 */

export interface ProjectionInput {
  program: {
    id: string;
    programKey: string;
    name: string;
    level: string;
    field: string;
    description: string | null;
    durationMonths: number;
    version: number;
    status: string;
    syncState: SyncState;
    staleFields: string[];
    institutionId: string;
  };
  institution: {
    displayName: string;
    country: string;
    verificationState: string;
    verificationStage: string | null;
  };
  campus: { city: string | null } | null;
  fees: {
    tuitionMinor: number;
    tuitionCurrency: string;
    applicationFeeMinor: number | null;
  } | null;
  intakes: readonly {
    startDate: Date;
    applicationDeadline: Date;
    status: string;
  }[];
  /** Set by the partnership record; Phase 5 fills these in properly. */
  scholarshipAvailable?: boolean;
  discountAvailable?: boolean;
  sponsored?: boolean;
  language?: string;
}

/** `YYYY-MM`, matching how intakes are filtered and how a profile states one. */
function intakeKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildSearchDocument(input: ProjectionInput, now: Date = new Date()): SearchDocument {
  const { program, institution, campus, fees } = input;

  // Only intakes a student could still act on. A closed intake in the facet
  // list is a filter that returns programmes nobody can apply to.
  const openIntakes = input.intakes.filter((intake) => {
    const status = deriveIntakeStatus(
      {
        startDate: intake.startDate.toISOString(),
        applicationDeadline: intake.applicationDeadline.toISOString(),
        status: intake.status as 'scheduled' | 'open' | 'closing_soon' | 'closed' | 'cancelled',
      },
      now,
    );
    return status === 'open' || status === 'closing_soon' || status === 'scheduled';
  });

  const deadlines = openIntakes
    .map((intake) => intake.applicationDeadline)
    .sort((a, b) => a.getTime() - b.getTime());

  const visibility = publicVisibility(program.syncState, program.staleFields);
  const published = program.status === 'published';

  const city = campus?.city ?? null;
  const searchText = [
    program.name,
    program.field,
    program.description ?? '',
    institution.displayName,
    city ?? '',
    institution.country,
  ]
    .filter((part) => part.length > 0)
    .join(' ');

  return {
    programKey: program.programKey,
    programId: program.id,
    version: program.version,
    name: program.name,
    description: program.description,
    level: program.level,
    discipline: program.field,
    language: input.language ?? 'English',
    institutionId: program.institutionId,
    institutionName: institution.displayName,
    institutionVerified:
      institution.verificationState === 'verified' && institution.verificationStage === 'active',
    country: institution.country,
    city,
    durationMonths: program.durationMonths,
    tuitionMinor: fees?.tuitionMinor ?? null,
    tuitionCurrency: fees?.tuitionCurrency ?? null,
    applicationFeeMinor: fees?.applicationFeeMinor ?? null,
    intakes: [...new Set(openIntakes.map((intake) => intakeKey(intake.startDate)))].sort(),
    nextDeadline: deadlines[0] ?? null,
    scholarshipAvailable: input.scholarshipAvailable ?? false,
    discountAvailable: input.discountAvailable ?? false,
    sponsored: input.sponsored ?? false,
    // Both halves must hold. A published programme whose blocking fields have
    // lapsed is hidden; an unpublished one is not searchable however fresh it is.
    visible: published && visibility !== 'hidden',
    staleFields: program.staleFields,
    syncState: program.syncState,
    searchText,
  };
}
