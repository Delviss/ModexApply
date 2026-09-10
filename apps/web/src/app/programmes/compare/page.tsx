import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  ComparisonTable,
  DisclosureNotice,
  EligibilityExplanation,
  EmptyState,
  formatDate,
  type CompareColumn,
  type CompareGroup,
} from '@modex/ui';
import {
  formatMoney,
  money,
  type EligibilityExplanation as Explanation,
} from '@modex/contracts';
import { ApiError, MONEY_REVALIDATE_SECONDS, apiGet, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { LEVEL_LABELS, MODE_LABELS } from '@/lib/labels';
import type { PublicProgramme } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Compare programmes',
  description: 'Compare up to four programmes side by side — fees, deadlines and requirements.',
};

const MAX_COLUMNS = 4;

/**
 * Side-by-side compare (Phase 2 §3, FR-006).
 *
 * Note what this page does *not* do: it has no "recommended" column. The vendor
 * comparison block highlights one by default, and that behaviour is removed
 * here deliberately — a visually promoted column would imply a recommendation
 * the ranking engine did not make, on a page whose whole purpose is letting the
 * student decide.
 *
 * This is also where `<EligibilityExplanation>` lives, in full rather than as a
 * chip: there is room here to show every rule with its source, which is what
 * makes a verdict contestable.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ keys?: string | string[] }>;
}) {
  const raw = await searchParams;
  const keys = (Array.isArray(raw.keys) ? raw.keys.join(',') : (raw.keys ?? ''))
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .slice(0, MAX_COLUMNS);

  if (keys.length === 0) {
    return (
      <main className="mx-compare-page">
        <Card padding="lg">
          <EmptyState
            title="Nothing to compare yet"
            description="Pick programmes from search to line them up side by side — fees, deadlines and the requirements each one publishes."
          >
            <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
              Find programmes
            </Link>
          </EmptyState>
        </Card>
      </main>
    );
  }

  const loaded = await Promise.all(
    keys.map(async (key) => {
      try {
        return {
          key,
          data: await apiGet<PublicProgramme>(`/programmes/${key}/public`, {
            revalidate: MONEY_REVALIDATE_SECONDS,
          }),
        };
      } catch (error) {
        // One unavailable programme must not blank the whole comparison — the
        // other three are still the answer the student came for.
        if (!(error instanceof ApiError)) throw error;
        return { key, data: null };
      }
    }),
  );

  const available = loaded.filter(
    (entry): entry is { key: string; data: PublicProgramme } => entry.data !== null,
  );

  const token = await sessionToken();
  let explanations: Record<string, Explanation> = {};
  if (token !== null && available.length > 0) {
    try {
      explanations = (
        await apiGetAs<{ data: Record<string, Explanation> }>(
          `/eligibility?programKeys=${available.map((entry) => entry.key).join(',')}`,
          token,
        )
      ).data;
    } catch {
      // Eligibility is additive here. Losing it costs the student a panel, not
      // the comparison they asked for.
      explanations = {};
    }
  }

  const columns: CompareColumn[] = available.map((entry) => ({
    id: entry.key,
    title: entry.data.program.name,
    subtitle: entry.data.program.institution.displayName,
  }));

  const groups: CompareGroup[] = [
    {
      id: 'basics',
      label: 'The programme',
      rows: [
        row('level', 'Level', available, (p) => LEVEL_LABELS[p.program.level] ?? p.program.level),
        row('mode', 'Study mode', available, (p) => MODE_LABELS[p.program.studyMode] ?? p.program.studyMode),
        row('duration', 'Duration', available, (p) => `${p.program.durationMonths} months`),
        row('country', 'Country', available, (p) => p.program.institution.country),
        row('campus', 'Campus', available, (p) => p.program.campus?.city ?? 'Not published'),
      ],
    },
    {
      id: 'cost',
      label: 'Cost',
      rows: [
        row('tuition', 'Tuition per year', available, (p) => {
          const [fees] = p.program.fees;
          return fees === undefined
            ? 'Not published'
            : formatMoney(money(fees.tuitionMinor, fees.tuitionCurrency));
        }),
        row('applicationFee', 'Application fee', available, (p) => {
          const [fees] = p.program.fees;
          if (fees === undefined || fees.applicationFeeMinor === null) return 'Not published';
          return formatMoney(
            money(fees.applicationFeeMinor, fees.applicationFeeCurrency ?? fees.tuitionCurrency),
          );
        }),
      ],
    },
    {
      id: 'deadlines',
      label: 'Deadlines',
      rows: [
        row('nextIntake', 'Next intake', available, (p) => {
          const [intake] = p.intakes;
          return intake === undefined ? 'Not published' : formatDate(intake.startDate);
        }),
        row('deadline', 'Apply by', available, (p) => {
          const [intake] = p.intakes;
          return intake === undefined ? 'Not published' : formatDate(intake.applicationDeadline);
        }),
      ],
    },
    {
      id: 'requirements',
      label: 'Requirements',
      rows: [
        row('requirementCount', 'Published requirements', available, (p) =>
          p.program.requirements.length === 0
            ? 'None published'
            : `${p.program.requirements.length}`,
        ),
      ],
    },
  ];

  return (
    <main className="mx-compare-page">
      <header>
        <h1 className="mx-card__title">Comparing {available.length} programmes</h1>
        <p className="mx-card__description">
          Everything here comes from what the university published. Where a figure is
          missing, we say so rather than guessing.
        </p>
      </header>

      {loaded.length !== available.length ? (
        <Card padding="md">
          <CardHeader
            title="One programme could not be shown"
            description="It is temporarily unavailable while we confirm its details with the university. It has not been withdrawn."
          />
        </Card>
      ) : null}

      <Card padding="lg">
        <ComparisonTable
          caption={`Comparison of ${available.length} programmes`}
          columns={columns}
          groups={groups}
        />
      </Card>

      {/* Ranking is not shown here, but the page orders programmes the student
          arrived with, and the disclosure is a landmark on every such surface. */}
      <DisclosureNotice kind="ranking_method" />

      {token === null ? (
        <Card padding="lg">
          <CardHeader
            title="Check your eligibility"
            description="Sign in and complete your profile to see, requirement by requirement, which of these you already meet — and what is missing where we cannot tell."
          />
        </Card>
      ) : (
        <section className="mx-compare-page__eligibility">
          {available.map((entry) => {
            const explanation = explanations[entry.key];
            return (
              <Card padding="lg" key={entry.key}>
                <CardHeader
                  title={entry.data.program.name}
                  description={entry.data.program.institution.displayName}
                />
                <div className="mx-compare-page__panel">
                  {explanation === undefined ? (
                    <p className="mx-card__description">
                      We could not run the eligibility check for this programme just now.
                      That is not a result about your eligibility.
                    </p>
                  ) : (
                    <EligibilityExplanation explanation={explanation} />
                  )}
                </div>
              </Card>
            );
          })}
        </section>
      )}
    </main>
  );
}

function row(
  id: string,
  label: string,
  entries: readonly { key: string; data: PublicProgramme }[],
  value: (programme: PublicProgramme) => string,
) {
  return {
    id,
    label,
    cells: Object.fromEntries(entries.map((entry) => [entry.key, value(entry.data)])),
  };
}
