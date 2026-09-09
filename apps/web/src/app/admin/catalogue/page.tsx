import type { Metadata } from 'next';
import { AppShell, Badge, Card, CardHeader, StatCard } from '@modex/ui';
import { CatalogueAdmin, type CatalogueRow, type SyncDiffRow } from '@/components/catalogue-admin';

export const metadata: Metadata = {
  title: 'Catalogue admin',
  robots: { index: false },
};

/**
 * Catalogue admin shell.
 *
 * Rows are illustrative here: the live data path lands with the university
 * portal in Phase 6 (#8), which is where authentication and the organisation
 * switcher belong. What this page proves now is that the Phase 1 surface --
 * filters, bulk actions, the sync diff and the record drawer -- is built and
 * bound to the Red Velvet tokens.
 */
const ROWS: CatalogueRow[] = [
  {
    programKey: 'seed-msc-data-science',
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing and Mathematics',
    status: 'published',
    syncState: 'synced',
    version: 1,
    sourceUpdatedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    expiresAt: null,
    sourceRef: 'https://example.ac.uk/courses/msc-data-science',
    reviewedBy: 'M. Haddad, Modex Ops',
    staleFields: [],
    tuitionMinor: 2_400_000,
    tuitionCurrency: 'GBP',
    nextDeadline: '2027-07-01T00:00:00.000Z',
  },
  {
    programKey: 'seed-bsc-computer-science',
    name: 'BSc Computer Science',
    level: 'undergraduate',
    field: 'Computing',
    status: 'published',
    syncState: 'stale',
    version: 1,
    sourceUpdatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    verifiedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: null,
    sourceRef: 'https://example.ac.uk/courses/bsc-computer-science',
    reviewedBy: 'M. Haddad, Modex Ops',
    staleFields: ['description'],
    tuitionMinor: 1_850_000,
    tuitionCurrency: 'GBP',
    nextDeadline: '2027-06-15T00:00:00.000Z',
  },
  {
    programKey: 'draft-ma-education',
    name: 'MA Education',
    level: 'postgraduate_taught',
    field: 'Education',
    status: 'draft',
    syncState: 'manual',
    version: 1,
    sourceUpdatedAt: new Date().toISOString(),
    verifiedAt: null,
    expiresAt: null,
    sourceRef: null,
    reviewedBy: null,
    staleFields: [],
    tuitionMinor: null,
    tuitionCurrency: null,
    nextDeadline: null,
  },
];

const DIFF: SyncDiffRow[] = [
  {
    externalRef: 'MSC-DS',
    kind: 'update',
    changes: [
      { field: 'tuitionFee', before: '2400000 GBP', after: '2550000 GBP', severity: 'blocking' },
      { field: 'description', before: 'A taught masters.', after: 'A one-year taught masters.', severity: 'warning' },
    ],
    errors: [],
  },
  {
    externalRef: 'BSC-CS',
    kind: 'unchanged',
    changes: [],
    errors: [],
  },
  {
    externalRef: 'MA-ED',
    kind: 'error',
    changes: [],
    errors: [
      'Missing required column "name".',
      '"01/08/2026" in applicationDeadline is not a date we can read. Use ISO 8601 (YYYY-MM-DD) -- a format like 01/08/2026 is ambiguous and we will not guess.',
    ],
  },
];

export default function CatalogueAdminPage() {
  const published = ROWS.filter((row) => row.status === 'published').length;
  const stale = ROWS.filter((row) => row.syncState === 'stale').length;

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
            { id: 'programmes', label: 'Programmes', href: '/admin/catalogue', current: true },
            { id: 'intakes', label: 'Intakes', href: '/admin/catalogue/intakes' },
            { id: 'imports', label: 'Imports', href: '/admin/catalogue/imports' },
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
      topbar={<strong>Programme catalogue</strong>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatCard label="Programmes" value={ROWS.length} />
          <StatCard label="Published" value={published} />
          <StatCard
            label="Needs re-confirming"
            value={stale}
            trend={stale > 0 ? { direction: 'up', label: 'action needed', isGood: false } : undefined}
            caption={stale > 0 ? 'A stale price or deadline hides the record' : undefined}
          />
          <StatCard label="Drafts" value={ROWS.filter((row) => row.status === 'draft').length} />
        </section>

        <Card padding="lg">
          <CardHeader
            title="Programmes"
            description="Editing a published programme creates a new effective-dated version. Applications already submitted against the old one are unaffected."
          />
        </Card>

        <CatalogueAdmin rows={ROWS} diff={DIFF} />
      </div>
    </AppShell>
  );
}
