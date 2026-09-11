import Link from 'next/link';
import {
  Card,
  CardHeader,
  EmptyState,
  OfferCard,
  PriceBreakdown,
} from '@modex/ui';
import { formatMoney, money, type PriceBreakdown as Breakdown } from '@modex/contracts';
import { ApiError, MONEY_REVALIDATE_SECONDS, apiGet, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import type { ProgrammePricing } from '@/lib/offers';

/**
 * The price panel on a programme page (Phase 5 §3).
 *
 * Signed in, it shows the net price after every offer the student actually
 * qualifies for. Signed out, it shows the university's published price and the
 * offers with their conditions unassessed — which is the honest version of
 * "you might qualify for this", and the opposite of the usual pattern of
 * advertising the best possible discount to somebody nobody has checked.
 *
 * The read is deliberately split in two: an anonymous read goes through the
 * cached public helper, and a signed-in read through the never-cached
 * authenticated one. Next's data cache is keyed on the URL and not on the
 * session, so one student's eligibility-filtered net price served to the next
 * student is exactly the failure that split prevents.
 */
export async function PricePanel({ programKey }: { programKey: string }) {
  const token = await sessionToken();

  let pricing: ProgrammePricing | null = null;
  try {
    pricing =
      token === null
        ? await apiGet<ProgrammePricing>(`/programmes/${encodeURIComponent(programKey)}/price`, {
            revalidate: MONEY_REVALIDATE_SECONDS,
          })
        : await apiGetAs<ProgrammePricing>(
            `/programmes/${encodeURIComponent(programKey)}/price`,
            token,
          );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    pricing = null;
  }

  if (pricing === null) {
    return (
      <Card padding="lg">
        <CardHeader
          title="We could not work out your price"
          description="Something went wrong on our side. This is not a statement about what you would pay — the university's published fees above still stand."
        />
      </Card>
    );
  }

  const { breakdown, offers, tuition } = pricing;
  const suppressed = new Map(breakdown.suppressed.map((entry) => [entry.offerKey, entry.reason]));
  const ineligible = new Map(breakdown.ineligible.map((entry) => [entry.offerKey, entry]));

  if (offers.length === 0) {
    return (
      <Card padding="lg">
        <CardHeader title="Scholarships and discounts" />
        <div style={{ marginTop: 'var(--mx-space-4)' }}>
          <EmptyState
            title="No verified offers on this programme"
            description="This university has not published any scholarship, discount or fee waiver through Modex for this course. We list only offers we have checked against the university's own published terms, so an empty list here means there is nothing to check rather than nothing to find — ask a student guide what they were offered."
          >
            <Link href={`/programmes/${programKey}#guides`}>Ask a student guide</Link>
          </EmptyState>
        </div>
      </Card>
    );
  }

  return (
    <>
      {tuition === null ? null : (
        <Card padding="lg" elevation={2}>
          <CardHeader
            title="What you would pay"
            description="First-year cost, after the offers you qualify for. Every line traces to the offer version and source that produced it."
          />
          <div style={{ marginTop: 'var(--mx-space-4)' }}>
            <PriceBreakdown breakdown={breakdown} />
          </div>
          {token === null ? (
            <p style={{ marginTop: 'var(--mx-space-4)', fontSize: 'var(--mx-text-sm)' }}>
              <Link href={`/login?next=/programmes/${programKey}`}>Sign in</Link> to see which of
              these you qualify for. Until then we show the university&rsquo;s published price, not a
              discount you may not get.
            </p>
          ) : null}
        </Card>
      )}

      <Card padding="lg">
        <CardHeader
          title="Scholarships and discounts"
          description="Every offer here has a named verifier and a last-checked date. Ones you do not qualify for are shown with the reason, not hidden."
        />
        <div
          style={{
            marginTop: 'var(--mx-space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--mx-space-4)',
          }}
        >
          {offers.map((offer) => (
            <OfferCard
              key={offer.offerKey}
              offerId={offer.offerId}
              name={offer.name}
              type={offer.type}
              value={offer.value}
              duration={offer.duration}
              savingLabel={savingLabel(breakdown, offer.offerKey)}
              validUntil={offer.validUntil}
              claimDeadline={offer.claimDeadline}
              termsSummary={offer.termsSummary}
              applicationMethod={offer.applicationMethod}
              redemptionMethod={offer.redemptionMethod}
              exclusions={offer.exclusions}
              sourceRef={offer.sourceRef}
              verifiedBy={offer.verifiedBy}
              verifiedAt={offer.verifiedAt}
              lastCheckedAt={offer.lastCheckedAt}
              verificationState="verified"
              eligible={offer.eligible}
              unmetCondition={ineligible.get(offer.offerKey)?.unmetCondition ?? null}
              remedy={ineligible.get(offer.offerKey)?.remedy ?? null}
              suppressedReason={suppressed.get(offer.offerKey) ?? null}
            />
          ))}
        </div>
      </Card>
    </>
  );
}

/** What this offer took off, taken from the breakdown rather than recomputed. */
function savingLabel(breakdown: Breakdown, offerKey: string): string | null {
  const line = breakdown.lines.find((entry) => entry.offerKey === offerKey);
  if (line === undefined) return null;
  return formatMoney(money(line.amount.amountMinor, line.amount.currency));
}
