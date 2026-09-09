import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Card,
  CardHeader,
  DisclosureNotice,
  EmptyState,
  HeroSection,
  StatCard,
  TaskSteps,
  VerificationBadge,
} from '@modex/ui';
import { STAGE_LABELS, type VerificationStage } from '@modex/contracts';
import { ApiError, apiGet, type PublicInstitution } from '@/lib/api';
import { institutionClaim } from '@/lib/verification';

/**
 * Public institution page (Phase 1 design spec).
 *
 * Server-rendered for SEO, with structured data. The verification badge sits
 * above the fold on purpose: the single question a student is asking on this
 * page is whether this university, and this route to it, is real.
 */

interface PageProps {
  params: Promise<{ id: string }>;
}

async function loadInstitution(id: string): Promise<PublicInstitution | null> {
  try {
    return await apiGet<PublicInstitution>(`/institutions/${encodeURIComponent(id)}/public`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  // See the note on the programme page: a throw here bypasses `error.tsx`, so
  // metadata degrades rather than deciding the whole page's fate.
  const institution = await loadInstitution(id).catch(() => null);
  if (institution === null) return { title: 'Institution not found' };

  return {
    title: institution.displayName,
    description:
      institution.description ??
      `Apply directly to ${institution.displayName} through Modex Apply.`,
    alternates: { canonical: `/institutions/${institution.id}` },
    openGraph: {
      title: institution.displayName,
      description: institution.description ?? undefined,
      type: 'website',
    },
  };
}

export default async function InstitutionPage({ params }: PageProps) {
  const { id } = await params;
  const institution = await loadInstitution(id);
  if (institution === null) notFound();

  const claim = institutionClaim(institution);
  const partnership = institution.partnerships[0];
  const canApplyDirect = partnership?.scopes.includes('direct_application') ?? false;

  /**
   * Structured data for search. Only claims we can actually stand behind go in:
   * an unverified institution gets no `EducationalOrganization` markup, because
   * that markup is a claim to search engines and to students reading a result.
   */
  const structuredData = institution.canDisplayVerifiedBadge
    ? {
        '@context': 'https://schema.org',
        '@type': 'CollegeOrUniversity',
        name: institution.displayName,
        url: institution.websiteUrl ?? undefined,
        address: institution.campuses.map((campus) => ({
          '@type': 'PostalAddress',
          addressLocality: campus.city,
          addressCountry: campus.country,
        })),
      }
    : null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      {structuredData !== null ? (
        <script
          type="application/ld+json"
          // Serialised from our own projection, never from user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}

      <HeroSection
        eyebrow={<VerificationBadge claim={claim} variant="full" />}
        title={institution.displayName}
        description={
          institution.description ??
          'This university has not yet published a description through Modex.'
        }
        primaryAction={{ label: 'Browse programmes', href: `/institutions/${institution.id}/programmes` }}
        secondaryAction={{ label: 'Talk to a student', href: `/institutions/${institution.id}/guides` }}
        footnote={
          canApplyDirect
            ? 'Applications submitted through Modex go directly to this university. Modex does not make admission decisions.'
            : 'This university has not yet enabled direct applications through Modex.'
        }
      />

      {!institution.canDisplayVerifiedBadge ? (
        <div style={{ padding: '0 var(--mx-space-6) var(--mx-space-6)' }}>
          <Alert tone="warning" title="This university is not fully verified yet">
            We are still working through our verification steps with this institution. Until every
            step is complete we do not show a verified badge, and we do not recommend sending
            documents or money to anyone claiming to represent it.
          </Alert>
        </div>
      ) : null}

      <section
        aria-label="At a glance"
        style={{
          display: 'grid',
          gap: 'var(--mx-space-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          padding: '0 var(--mx-space-6) var(--mx-space-8)',
        }}
      >
        <StatCard label="Campuses" value={institution.campuses.length} />
        <StatCard label="Country" value={institution.country} />
        <StatCard
          label="Partnership"
          value={partnership?.status === 'active' ? 'Active' : 'Not active'}
          caption={
            partnership?.startDate !== null && partnership?.startDate !== undefined
              ? `Since ${new Date(partnership.startDate).getFullYear()}`
              : undefined
          }
        />
        <StatCard
          label="Direct applications"
          value={canApplyDirect ? 'Enabled' : 'Not enabled'}
        />
      </section>

      <section
        style={{
          display: 'grid',
          gap: 'var(--mx-space-6)',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
          padding: '0 var(--mx-space-6) var(--mx-space-16)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
          <Card padding="lg">
            <CardHeader
              title="Campuses"
              description="Programmes and student guides are matched to a campus, not just to a university."
            />
            {institution.campuses.length === 0 ? (
              <EmptyState
                title="No campuses published yet"
                description="This university has not published campus details through Modex. It does not mean it has none — only that we have nothing verified to show you."
              />
            ) : (
              <ul style={{ listStyle: 'none', margin: 'var(--mx-space-4) 0 0', padding: 0 }}>
                {institution.campuses.map((campus) => (
                  <li
                    key={campus.id}
                    style={{
                      padding: 'var(--mx-space-3) 0',
                      borderBottom: '1px solid var(--mx-border)',
                    }}
                  >
                    <strong>{campus.name}</strong>
                    <div style={{ color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>
                      {campus.city}, {campus.country}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader
              title="How we verified this university"
              description="Every step has an owner and a date. A failure at any step means no verified badge at all."
            />
            <div style={{ marginTop: 'var(--mx-space-4)' }}>
              <TaskSteps
                aria-label="Verification pipeline"
                steps={institution.verificationPipeline.map((entry) => ({
                  id: entry.stage,
                  title: STAGE_LABELS[entry.stage as VerificationStage] ?? entry.stage,
                  status: entry.status,
                  description: STAGE_DESCRIPTIONS[entry.stage] ?? undefined,
                }))}
              />
            </div>
          </Card>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
          <Card padding="lg">
            <CardHeader title="Official domains" description="Confirmed by DNS record." />
            <ul style={{ margin: 'var(--mx-space-3) 0 0', paddingLeft: 'var(--mx-space-4)' }}>
              {institution.domains.map((domain) => (
                <li key={domain} style={{ fontSize: 'var(--mx-text-sm)' }}>
                  {domain}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)', marginTop: 'var(--mx-space-3)' }}>
              An email about your application from any other domain did not come from this
              university. Tell us if you receive one.
            </p>
          </Card>

          {partnership !== undefined ? <DisclosureNotice kind="partnership" /> : null}

          <Card padding="lg">
            <CardHeader title="What Modex does not do" />
            <ul
              style={{
                margin: 'var(--mx-space-3) 0 0',
                paddingLeft: 'var(--mx-space-4)',
                fontSize: 'var(--mx-text-sm)',
                color: 'var(--mx-ink-600)',
                lineHeight: 'var(--mx-leading-body)',
              }}
            >
              <li>We do not make admission decisions. The university does.</li>
              <li>We do not give immigration or legal advice.</li>
              <li>We do not guarantee visas, admissions, jobs, salaries or scholarships.</li>
              <li>Our student guides never collect application fees or tuition.</li>
            </ul>
          </Card>

          <p style={{ fontSize: 'var(--mx-text-sm)' }}>
            <Link href={`/institutions/${institution.id}/programmes`}>
              See every published programme
            </Link>
          </p>
        </aside>
      </section>
    </main>
  );
}

const STAGE_DESCRIPTIONS: Record<string, string> = {
  legal_entity_check: 'We confirmed the institution exists as a legal entity in its own country.',
  official_domain_confirmation:
    'A DNS record only a domain administrator could publish proved control of the official domain.',
  partner_contact_confirmation:
    'A named authorised signatory was verified on an address at that official domain.',
  signed_contract: 'An executed partnership contract is on file with Modex.',
  active: 'The partnership is live and the university can publish its catalogue.',
};
