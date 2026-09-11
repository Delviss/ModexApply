import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  DisclosureNotice,
  ProvenanceStamp,
  SearchableAccordion,
  VerificationBadge,
  formatDate,
} from '@modex/ui';
import { deriveIntakeStatus, formatMoney, money } from '@modex/contracts';
import {
  ApiError,
  MONEY_REVALIDATE_SECONDS,
  apiGet,
  toProvenance,
  type PublicProgramme,
} from '@/lib/api';
import {
  INTAKE_LABELS,
  INTAKE_TONES,
  LEVEL_LABELS,
  MODE_LABELS,
  RULE_LABELS,
} from '@/lib/labels';
import { EligibilityPanel } from '@/components/eligibility-panel';
import { PricePanel } from '@/components/price-panel';
import { programmeClaim } from '@/lib/verification';

/**
 * Public programme page (Phase 1 design spec).
 *
 * Split layout: content left, a sticky fee + deadline + eligibility card right.
 * The provenance stamp is permanent and never behind a tooltip -- a student
 * deciding whether to trust a tuition figure should not have to hover to learn
 * it was last confirmed eight months ago.
 */

interface PageProps {
  params: Promise<{ programKey: string }>;
}

type LoadResult =
  | { kind: 'ok'; data: PublicProgramme }
  | { kind: 'unavailable'; staleFields: string[] }
  | { kind: 'missing' };

async function loadProgramme(programKey: string): Promise<LoadResult> {
  try {
    const data = await apiGet<PublicProgramme>(
      `/programmes/${encodeURIComponent(programKey)}/public`,
      { revalidate: MONEY_REVALIDATE_SECONDS },
    );
    return { kind: 'ok', data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    // A programme pulled back for a stale blocking field is not missing, and
    // saying "not found" would tell a student it no longer exists.
    if (error instanceof ApiError && error.code === 'precondition_failed') {
      return {
        kind: 'unavailable',
        staleFields: (error.details?.staleFields as string[] | undefined) ?? [],
      };
    }
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { programKey } = await params;

  // `generateMetadata` runs before the page and its throws bypass `error.tsx`
  // entirely, so an unreachable API here would take down a page that is
  // perfectly capable of handling the failure itself. Metadata degrades; the
  // page decides what the reader sees.
  const result = await loadProgramme(programKey).catch(
    () => ({ kind: 'missing' }) as LoadResult,
  );
  if (result.kind !== 'ok') return { title: 'Programme unavailable', robots: { index: false } };

  const { program } = result.data;
  return {
    title: `${program.name} · ${program.institution.displayName}`,
    description:
      program.description ??
      `${program.name} at ${program.institution.displayName}. Apply directly through Modex.`,
    alternates: { canonical: `/programmes/${program.programKey}` },
  };
}

export default async function ProgrammePage({ params }: PageProps) {
  const { programKey } = await params;
  const result = await loadProgramme(programKey);

  if (result.kind === 'missing') notFound();

  if (result.kind === 'unavailable') {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--mx-space-16) var(--mx-space-6)' }}>
        <Alert tone="warning" title="This programme is temporarily unavailable">
          <p>
            We are re-confirming{' '}
            {result.staleFields.length > 0 ? result.staleFields.join(' and ') : 'some details'} with
            the university. Rather than show you a figure we cannot stand behind, we have taken the
            page down until they confirm it.
          </p>
          <p style={{ marginTop: 'var(--mx-space-2)' }}>
            The programme has not been withdrawn. Check back shortly, or{' '}
            <Link href="/programmes">browse other programmes</Link>.
          </p>
        </Alert>
      </main>
    );
  }

  const { program, intakes, visibility } = result.data;
  const fees = program.fees[0];
  const institutionVerified = program.institution.verificationState === 'verified';
  const now = new Date();

  const nextIntake = intakes
    .map((intake) => ({
      ...intake,
      derivedStatus: deriveIntakeStatus(
        {
          applicationDeadline: intake.applicationDeadline,
          startDate: intake.startDate,
          status: intake.status as 'scheduled' | 'open' | 'closing_soon' | 'closed' | 'cancelled',
        },
        now,
      ),
    }))
    .find((intake) => intake.derivedStatus === 'open' || intake.derivedStatus === 'closing_soon');

  const structuredData = institutionVerified
    ? {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: program.name,
        description: program.description ?? undefined,
        provider: {
          '@type': 'CollegeOrUniversity',
          name: program.institution.displayName,
        },
        educationalCredentialAwarded: program.level,
        timeRequired: `P${program.durationMonths}M`,
      }
    : null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--mx-space-8) var(--mx-space-6)' }}>
      {structuredData !== null ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}

      <nav aria-label="Breadcrumb" style={{ fontSize: 'var(--mx-text-sm)', marginBottom: 'var(--mx-space-4)' }}>
        <Link href="/programmes">Programmes</Link>
        {' / '}
        <Link href={`/institutions/${program.institution.id}`}>{program.institution.displayName}</Link>
        {' / '}
        <span style={{ color: 'var(--mx-ink-600)' }}>{program.name}</span>
      </nav>

      {visibility === 'visible_with_warning' ? (
        <Alert tone="warning" title="Some details have not been confirmed recently">
          The university has not re-confirmed{' '}
          {program.staleFields.length > 0 ? program.staleFields.join(', ') : 'part of this record'}{' '}
          within our freshness window. Fees and deadlines below are still current; treat the rest as
          indicative and check with the university.
        </Alert>
      ) : null}

      <div
        style={{
          display: 'grid',
          gap: 'var(--mx-space-8)',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)',
          alignItems: 'start',
          marginTop: 'var(--mx-space-4)',
        }}
      >
        <article style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
          <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-3)' }}>
            <div
              style={{
                display: 'flex',
                gap: 'var(--mx-space-2)',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}
            >
              <VerificationBadge
                claim={programmeClaim({
                  id: program.id,
                  institutionVerified,
                  verifiedAt: program.verifiedAt,
                  expiresAt: program.expiresAt,
                })}
              />
              <Badge tone="neutral">{LEVEL_LABELS[program.level] ?? program.level}</Badge>
              <Badge tone="neutral">{program.durationMonths} months</Badge>
              <Badge tone="neutral">{MODE_LABELS[program.studyMode] ?? program.studyMode}</Badge>
            </div>

            <h1 style={{ margin: 0, fontSize: 'var(--mx-text-3xl)', lineHeight: 'var(--mx-leading-tight)' }}>
              {program.name}
            </h1>
            <p style={{ margin: 0, color: 'var(--mx-ink-600)' }}>
              {program.institution.displayName}
              {program.campus !== null ? ` · ${program.campus.name}, ${program.campus.city}` : ''}
            </p>

            {/* Small, permanent, never hidden behind a tooltip alone. */}
            <ProvenanceStamp
              provenance={toProvenance(program)}
              staleFields={program.staleFields}
            />
          </header>

          {program.description !== null ? (
            <Card padding="lg">
              <CardHeader title="About this programme" />
              <p style={{ marginTop: 'var(--mx-space-3)', lineHeight: 'var(--mx-leading-body)' }}>
                {program.description}
              </p>
            </Card>
          ) : null}

          <Card padding="lg">
            <CardHeader
              title="Entry requirements"
              description="Each requirement is published by the university and cites its source. If one looks wrong, tell us and we will ask them."
            />
            <div style={{ marginTop: 'var(--mx-space-4)' }}>
              <SearchableAccordion
                label="Entry requirements"
                searchPlaceholder="Filter requirements (try IELTS, degree, experience)"
                items={program.requirements.map((requirement) => ({
                  id: requirement.id,
                  question: requirement.humanSummary,
                  searchText: `${requirement.humanSummary} ${requirement.ruleType}`,
                  answer: (
                    <div>
                      <p style={{ margin: 0 }}>
                        Requirement type: {RULE_LABELS[requirement.ruleType] ?? requirement.ruleType}
                      </p>
                      <p style={{ margin: 'var(--mx-space-2) 0 0', fontSize: 'var(--mx-text-xs)' }}>
                        Source:{' '}
                        <a href={requirement.sourceRef} rel="nofollow noopener">
                          {requirement.sourceRef}
                        </a>
                      </p>
                    </div>
                  ),
                }))}
              />
            </div>
          </Card>

          <Card padding="lg">
            <CardHeader
              title="Intakes"
              description="Deadlines drive the status automatically. A closed intake is never shown as open."
            />
            <div className="mx-table-wrap" style={{ marginTop: 'var(--mx-space-4)', border: 'none' }}>
              <table className="mx-table">
                <caption className="mx-visually-hidden">Intakes for {program.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Starts</th>
                    <th scope="col">Apply by</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {intakes.map((intake) => {
                    const status = deriveIntakeStatus(
                      {
                        applicationDeadline: intake.applicationDeadline,
                        startDate: intake.startDate,
                        status: intake.status as 'scheduled' | 'open' | 'closing_soon' | 'closed' | 'cancelled',
                      },
                      now,
                    );
                    return (
                      <tr key={intake.id}>
                        <td>{formatDate(intake.startDate)}</td>
                        <td>{formatDate(intake.applicationDeadline)}</td>
                        <td>
                          <Badge tone={INTAKE_TONES[status]}>{INTAKE_LABELS[status]}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </article>

        <aside style={{ position: 'sticky', top: 'var(--mx-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
          {/*
            The eligibility explanation lives here rather than as a chip on a
            search result card: it needs room to show every rule with its
            source, which is what makes a verdict something a student can argue
            with rather than just receive.
          */}
          <EligibilityPanel programKey={programKey} />

          <Card padding="lg" elevation={2}>
            <CardHeader title="Cost and deadline" />
            {fees === undefined ? (
              <p style={{ marginTop: 'var(--mx-space-3)', color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>
                The university has not published fees for this programme through Modex. We will not
                estimate them.
              </p>
            ) : (
              <>
                <dl style={{ margin: 'var(--mx-space-4) 0 0' }}>
                  <FeeRow
                    label="Tuition"
                    value={formatMoney(money(fees.tuitionMinor, fees.tuitionCurrency))}
                    emphasis
                  />
                  {fees.applicationFeeMinor !== null && fees.applicationFeeCurrency !== null ? (
                    <FeeRow
                      label="Application fee"
                      value={formatMoney(money(fees.applicationFeeMinor, fees.applicationFeeCurrency))}
                    />
                  ) : null}
                  {fees.depositMinor !== null && fees.depositCurrency !== null ? (
                    <FeeRow
                      label="Deposit"
                      value={formatMoney(money(fees.depositMinor, fees.depositCurrency))}
                    />
                  ) : null}
                </dl>
                <div style={{ marginTop: 'var(--mx-space-3)' }}>
                  <ProvenanceStamp provenance={toProvenance(fees)} />
                </div>
              </>
            )}

            <hr style={{ margin: 'var(--mx-space-4) 0', border: 0, borderTop: '1px solid var(--mx-border)' }} />

            {nextIntake === undefined ? (
              <p style={{ fontSize: 'var(--mx-text-sm)', color: 'var(--mx-ink-600)' }}>
                No intake is currently open for applications.
              </p>
            ) : (
              <p style={{ fontSize: 'var(--mx-text-sm)' }}>
                Next deadline: <strong>{formatDate(nextIntake.applicationDeadline)}</strong>
                <br />
                Starts {formatDate(nextIntake.startDate)}
              </p>
            )}

            <Link
              className="mx-button"
              data-variant="primary"
              data-size="lg"
              href={`/programmes/${program.programKey}/apply`}
              style={{ width: '100%', marginTop: 'var(--mx-space-4)' }}
              aria-disabled={nextIntake === undefined}
            >
              Apply direct
            </Link>

            <p style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)', marginTop: 'var(--mx-space-3)' }}>
              You pay the university directly. Modex does not add a fee to your tuition.
            </p>
          </Card>

          {/*
            The price panel sits directly under the university's own figures, and
            after the eligibility explanation, because a net price only means
            something once the student can see which conditions it depended on.
          */}
          <PricePanel programKey={programKey} />

          <DisclosureNotice kind="commission" />

          <Card padding="lg">
            <CardHeader title="Ask a student" description="Someone studying this course now." />
            <Link
              className="mx-button"
              data-variant="secondary"
              data-size="md"
              href={`/institutions/${program.institution.id}/guides`}
              style={{ width: '100%', marginTop: 'var(--mx-space-3)' }}
            >
              Find a student guide
            </Link>
          </Card>

          <p style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
            Showing version {program.version} of this record, effective from{' '}
            {formatDate(program.effectiveFrom)}.{' '}
            <Link href={`/programmes/${program.programKey}/history`}>See what changed</Link>.
          </p>
        </aside>
      </div>
    </main>
  );
}

function FeeRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--mx-space-3)', padding: '4px 0' }}>
      <dt style={{ color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontWeight: 'var(--mx-weight-semibold)',
          fontSize: emphasis ? 'var(--mx-text-lg)' : 'var(--mx-text-sm)',
        }}
      >
        {value}
      </dd>
    </div>
  );
}
