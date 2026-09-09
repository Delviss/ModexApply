import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardHeader, DisclosureNotice, EmptyState } from '@modex/ui';

export const metadata: Metadata = {
  title: 'Programmes',
  description: 'Browse verified programmes and apply directly to the university.',
};

/**
 * Catalogue search proper is Phase 2 (#4). Until it lands, this page says so
 * rather than shipping a search box that returns nothing -- the "explain why
 * there are no results" rule applies to features as well as to filters.
 */
export default function ProgrammesPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--mx-space-12) var(--mx-space-6)' }}>
      <Card padding="lg">
        <CardHeader
          title="Programme search"
          description="Search, comparison and the eligibility engine arrive with Phase 2."
        />
        <div style={{ marginTop: 'var(--mx-space-4)' }}>
          <EmptyState
            title="Search is not live yet"
            description="The catalogue exists and institution and programme pages are published, but the search and matching layer is the next phase of work. You can still open a programme page directly from an institution."
          >
            <Link className="mx-button" data-variant="primary" data-size="md" href="/">
              Back to the start
            </Link>
          </EmptyState>
        </div>
      </Card>
      <div style={{ marginTop: 'var(--mx-space-4)' }}>
        <DisclosureNotice kind="ranking_method" />
      </div>
    </main>
  );
}
