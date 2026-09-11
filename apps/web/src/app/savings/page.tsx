import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Badge, Card, CardHeader, EmptyState, StatCard, formatDate } from '@modex/ui';
import {
  OFFER_ATTACHMENT_LABELS,
  OFFER_TYPE_LABELS,
  formatMoney,
  formatOfferValue,
  money,
} from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import type { ApplicationOffers, SavingsReport } from '@/lib/offers';

export const metadata: Metadata = {
  title: 'Your savings',
  robots: { index: false },
};

interface ApplicationSummary {
  id: string;
  state: string;
  programName: string | null;
  institutionName?: string | null;
}

/**
 * The student's savings summary (Phase 5 §3).
 *
 * Two numbers, and the gap between them is the honest part: **secured** counts
 * only verified offers realised at enrolment, and **attached** counts what is
 * currently riding on live applications. A single headline figure that blurred
 * the two would be a marketing number, which is the specific thing this phase
 * exists to replace.
 */
export default async function SavingsPage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/savings');

  let report: SavingsReport;
  let applications: ApplicationSummary[] = [];
  try {
    report = await apiGetAs<SavingsReport>('/reports/savings', token);
    applications = (await apiGetAs<{ data: ApplicationSummary[] }>('/applications', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/savings');
    throw error;
  }

  const perApplication = await Promise.all(
    applications.map(async (application) => {
      try {
        return {
          application,
          offers: await apiGetAs<ApplicationOffers>(`/applications/${application.id}/offers`, token),
        };
      } catch {
        return { application, offers: null };
      }
    }),
  );

  const attached = perApplication.flatMap((entry) =>
    (entry.offers?.offers ?? []).filter(
      (offer) => offer.state === 'attached' || offer.state === 'accepted',
    ),
  );

  const attachedByCurrency = new Map<string, number>();
  for (const offer of attached) {
    if (offer.savingMinor === null || offer.currency === null) continue;
    attachedByCurrency.set(
      offer.currency,
      (attachedByCurrency.get(offer.currency) ?? 0) + offer.savingMinor,
    );
  }

  const nothingYet = report.realisedCount === 0 && attached.length === 0;

  return (
    <main className="mx-dashboard">
      <header>
        <h1 className="mx-card__title">Your savings</h1>
        <p className="mx-card__description">
          What verified offers are worth on your applications, and what has actually been realised.
        </p>
      </header>

      <div className="mx-dashboard__tiles">
        <StatCard
          label="Secured at enrolment"
          value={
            report.byCurrency.length === 0
              ? '—'
              : report.byCurrency
                  .map((entry) => formatMoney(money(entry.total.amountMinor, entry.total.currency)))
                  .join(' · ')
          }
          caption={`${report.realisedCount} verified offer${report.realisedCount === 1 ? '' : 's'} realised`}
        />
        <StatCard
          label="Riding on live applications"
          value={
            attachedByCurrency.size === 0
              ? '—'
              : [...attachedByCurrency]
                  .map(([currency, amount]) => formatMoney(money(amount, currency)))
                  .join(' · ')
          }
          caption="Not yours until the university confirms it at enrolment"
        />
        <StatCard
          label="Offers attached"
          value={attached.length}
          caption={`Across ${applications.length} application${applications.length === 1 ? '' : 's'}`}
        />
      </div>

      <Alert tone="info" title="What these two numbers mean">
        <p>
          <strong>Secured</strong> counts only offers a Modex verifier checked against the
          university&rsquo;s own published terms <em>and</em> that were realised when you enrolled.{' '}
          <strong>Riding on live applications</strong> is what those offers would be worth if
          everything goes through. We keep them apart on purpose: a discount you were eligible for
          and never used is not a saving, and we will not count it as one.
        </p>
      </Alert>

      {nothingYet ? (
        <Card padding="lg">
          <EmptyState
            title="No offers on your applications yet"
            description="You have not attached a scholarship, discount or fee waiver to an application. Offers appear on a programme's page once we have verified them against the university's own terms — including the ones you do not qualify for yet, with the reason."
          >
            <Link href="/programmes">Browse programmes</Link>
          </EmptyState>
        </Card>
      ) : (
        perApplication
          .filter((entry) => (entry.offers?.offers.length ?? 0) > 0)
          .map((entry) => (
            <Card padding="lg" key={entry.application.id}>
              <CardHeader
                title={entry.application.programName ?? 'Application'}
                description="Offers attached to this application, with the value frozen as it was when you attached them."
              />

              {entry.offers?.admissionOffer != null ? (
                <Alert
                  tone={entry.offers.admissionOffer.kind === 'unconditional' ? 'success' : 'info'}
                  title="The university's admission decision"
                >
                  {/*
                    Deliberately under its own heading, in its own words. An
                    admission offer is not a scholarship, and the day this page
                    lets one read as the other is the day the number above stops
                    meaning anything.
                  */}
                  <p>{entry.offers.admissionOffer.summary}</p>
                  {entry.offers.admissionOffer.conditions.length > 0 ? (
                    <ul style={{ marginTop: 'var(--mx-space-2)' }}>
                      {entry.offers.admissionOffer.conditions.map((condition) => (
                        <li key={condition.summary}>
                          {condition.met ? '✓ ' : '• '}
                          {condition.summary}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.offers.admissionOffer.respondByAt === null ? null : (
                    <p style={{ marginTop: 'var(--mx-space-2)' }}>
                      Reply to the university by{' '}
                      {formatDate(entry.offers.admissionOffer.respondByAt)}.
                    </p>
                  )}
                </Alert>
              ) : null}

              <div className="mx-table-wrap" style={{ marginTop: 'var(--mx-space-4)' }}>
                <table className="mx-table">
                  <caption className="mx-visually-hidden">
                    Offers attached to {entry.application.programName ?? 'this application'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Offer</th>
                      <th scope="col">Type</th>
                      <th scope="col">Value</th>
                      <th scope="col">Worth</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(entry.offers?.offers ?? []).map((offer) => (
                      <tr key={offer.offerKey}>
                        <td>
                          {offer.name}
                          <br />
                          <span style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
                            version {offer.offerVersion}
                            {offer.sourceRef === null ? null : (
                              <>
                                {' · '}
                                <a href={offer.sourceRef} rel="nofollow noopener">
                                  source
                                </a>
                              </>
                            )}
                          </span>
                        </td>
                        <td>{OFFER_TYPE_LABELS[offer.type]}</td>
                        <td>{formatOfferValue(offer.value)}</td>
                        <td>
                          {offer.savingMinor === null || offer.currency === null
                            ? '—'
                            : formatMoney(money(offer.savingMinor, offer.currency))}
                        </td>
                        <td>
                          <Badge tone={stateTone(offer.state)}>
                            {OFFER_ATTACHMENT_LABELS[offer.state]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
      )}
    </main>
  );
}

function stateTone(state: string) {
  if (state === 'realised') return 'success' as const;
  if (state === 'accepted') return 'info' as const;
  if (state === 'expired' || state === 'declined') return 'warning' as const;
  return 'neutral' as const;
}
