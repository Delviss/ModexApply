import type { Metadata } from 'next';
import { AppShell, Alert, Badge, Card, CardHeader, StatCard } from '@modex/ui';
import { OfferAdmin } from '@/components/offer-admin';
import type { AdminOffer } from '@/lib/offers';

export const metadata: Metadata = {
  title: 'Offer admin',
  robots: { index: false },
};

/**
 * University offer admin.
 *
 * Rows are illustrative, on the same footing as the catalogue admin shell: the
 * authenticated data path arrives with the university portal in Phase 6 (#8),
 * which is where the organisation switcher and staff sign-in belong. What this
 * page proves now is the shape of the surface — and specifically the thing an
 * admin most needs to see, which is *why* an offer cannot be published yet.
 *
 * The three rows below are the three states worth designing against: one live,
 * one verified but not yet published, and one draft that is missing exactly the
 * fields the publication gate refuses.
 */
const ROWS: AdminOffer[] = [
  {
    id: 'offer_merit',
    offerKey: 'example-merit-award-2027',
    version: 2,
    name: 'International Merit Award',
    type: 'scholarship',
    value: { kind: 'fixed_amount', amount: { amountMinor: 500_000, currency: 'GBP' } },
    appliesTo: 'tuition',
    duration: 'first_year',
    programKey: null,
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2027-06-30T00:00:00.000Z',
    claimDeadline: '2027-05-31T00:00:00.000Z',
    publicationState: 'published',
    verificationState: 'verified',
    verifiedBy: 'A. Okafor, Modex Trust',
    verifiedAt: '2026-08-20T00:00:00.000Z',
    lastCheckedAt: '2026-09-02T00:00:00.000Z',
    sourceRef: 'https://example.ac.uk/fees/international-merit-award',
    termsSummary: 'Awarded on academic merit. Applies to the first year of tuition only.',
    exclusions: [
      {
        kind: 'not_combinable_with_type',
        otherOfferKey: null,
        otherOfferType: 'tuition_discount',
        programKeys: [],
        humanSummary: 'Not combinable with any other tuition discount from this university.',
      },
    ],
    attachedApplications: 12,
    live: true,
    expiryUrgency: 'none',
    blockers: [],
  },
  {
    id: 'offer_waiver',
    offerKey: 'example-application-fee-waiver',
    version: 1,
    name: 'Application fee waiver',
    type: 'application_fee_waiver',
    value: { kind: 'full_waiver' },
    appliesTo: 'application_fee',
    duration: 'one_off',
    programKey: null,
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-20T00:00:00.000Z',
    claimDeadline: null,
    publicationState: 'in_review',
    verificationState: 'verified',
    verifiedBy: 'A. Okafor, Modex Trust',
    verifiedAt: '2026-09-01T00:00:00.000Z',
    lastCheckedAt: '2026-09-01T00:00:00.000Z',
    sourceRef: 'https://example.ac.uk/apply/fees',
    termsSummary: 'The £50 application fee is waived for applications made through Modex.',
    exclusions: [],
    attachedApplications: 0,
    live: false,
    expiryUrgency: 'due',
    blockers: [],
  },
  {
    id: 'offer_partner',
    offerKey: 'example-partner-discount-draft',
    version: 1,
    name: 'Partner discount (draft)',
    type: 'tuition_discount',
    value: { kind: 'percentage', basisPoints: 1000 },
    appliesTo: 'tuition',
    duration: 'every_year',
    programKey: 'seed-msc-data-science',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2027-08-31T00:00:00.000Z',
    claimDeadline: null,
    publicationState: 'draft',
    verificationState: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    lastCheckedAt: null,
    sourceRef: null,
    termsSummary: null,
    exclusions: [],
    attachedApplications: 0,
    live: false,
    expiryUrgency: 'none',
    blockers: [
      'A source reference: where at the university this offer is published.',
      'At least one eligibility condition. An offer with no conditions is a price change, not an offer.',
      'The conditions, in plain language.',
      'A named verifier.',
      'The date it was verified.',
      'The date the source was last checked.',
      'Verification: Modex Trust has not signed this offer off yet.',
    ],
  },
];

export default function OfferAdminPage() {
  const published = ROWS.filter((row) => row.publicationState === 'published').length;
  const closing = ROWS.filter(
    (row) => row.expiryUrgency === 'due' || row.expiryUrgency === 'urgent',
  ).length;
  const unchecked = ROWS.filter((row) => row.lastCheckedAt === null).length;

  return (
    <AppShell
      brand={<strong style={{ color: 'var(--mx-action)' }}>Modex Apply</strong>}
      organisation={
        <div className="mx-card" style={{ padding: 'var(--mx-space-3)' }}>
          <div style={{ fontSize: 'var(--mx-text-sm)', fontWeight: 'var(--mx-weight-medium)' }}>
            University of Example
          </div>
          <Badge tone="success">Verified partner</Badge>
        </div>
      }
      groups={[
        {
          id: 'catalogue',
          label: 'Catalogue',
          items: [
            { id: 'programmes', label: 'Programmes', href: '/admin/catalogue' },
            { id: 'offers', label: 'Offers', href: '/admin/offers', current: true },
          ],
        },
        {
          id: 'trust',
          label: 'Trust',
          items: [
            { id: 'verification', label: 'Verification', href: '/admin/verification' },
            { id: 'partnership', label: 'Partnership', href: '/admin/partnership' },
          ],
        },
      ]}
      topbar={<strong>Offers</strong>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatCard label="Offers" value={ROWS.length} />
          <StatCard label="Live" value={published} />
          <StatCard
            label="Closing soon"
            value={closing}
            trend={closing > 0 ? { direction: 'up', label: 'expiring', isGood: false } : undefined}
            caption={closing > 0 ? 'Lapsed offers leave search automatically' : undefined}
          />
          <StatCard
            label="Never re-checked"
            value={unchecked}
            trend={unchecked > 0 ? { direction: 'up', label: 'action needed', isGood: false } : undefined}
          />
        </section>

        <Alert tone="info" title="How an offer reaches a student">
          <p>
            Draft it here, then send it to Modex Trust. A verifier reads your published terms, records
            what they checked and when, and only then can the offer be published. You cannot sign off
            your own offer — that separation is the reason a Modex offer means anything.
          </p>
          <p style={{ marginTop: 'var(--mx-space-2)' }}>
            If what we display ever differs from what your own page says, we take the offer down
            first and ask afterwards. That is a trust incident, not a data correction, and we will
            never quietly rewrite the number to match.
          </p>
        </Alert>

        <Card padding="lg">
          <CardHeader
            title="Editing an offer creates a new version"
            description="Students who already attached the old version keep exactly what they were shown. The new version starts unverified, because an edit is a new claim and nobody has checked it yet."
          />
        </Card>

        <OfferAdmin rows={ROWS} />
      </div>
    </AppShell>
  );
}
