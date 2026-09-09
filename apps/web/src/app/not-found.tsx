import Link from 'next/link';
import { EmptyState } from '@modex/ui';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--mx-space-16) var(--mx-space-6)' }}>
      <EmptyState
        title="We could not find that page"
        description="The link may be out of date, or the programme may have been withdrawn by the university. Browsing the catalogue is the quickest way to find what replaced it."
      >
        <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
          Browse programmes
        </Link>
      </EmptyState>
    </main>
  );
}
