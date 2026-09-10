import Link from 'next/link';
import { Badge, Card, CardHeader, DisclosureNotice, HeroSection } from '@modex/ui';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <HeroSection
        eyebrow={<Badge tone="brand">Apply direct. Ask students. Save more.</Badge>}
        title="Apply directly to verified universities, with help from students who already study there."
        description="No agent in the middle. You keep your application and your documents, the university makes the decision, and the people answering your questions about life there are current students we have verified."
        primaryAction={{ label: 'Browse programmes', href: '/programmes' }}
        secondaryAction={{ label: 'Talk to a student', href: '/guides' }}
        footnote="Modex does not make admission decisions and does not guarantee visas, admissions, jobs or scholarships."
      />

      <section
        style={{
          display: 'grid',
          gap: 'var(--mx-space-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          padding: '0 var(--mx-space-6) var(--mx-space-12)',
        }}
      >
        <Card padding="lg">
          <CardHeader
            title="Every claim carries its evidence"
            description="A verified university has a confirmed official domain, a named signatory on that domain, and a signed contract. If any step is missing there is no badge — there is no partial badge."
          />
        </Card>
        <Card padding="lg">
          <CardHeader
            title="Prices and deadlines come with a date"
            description="Every catalogue record shows when the university last updated it and when we last confirmed it. If we cannot vouch for a tuition figure, we take the programme down rather than show you a number that may have changed."
          />
        </Card>
        <Card padding="lg">
          <CardHeader
            title="Guides are paid by us, never by you"
            description="Student guides answer questions about the course and the city. They never collect application fees or tuition, and they cannot submit an application on your behalf."
          />
        </Card>
      </section>

      <div style={{ padding: '0 var(--mx-space-6) var(--mx-space-16)' }}>
        <DisclosureNotice kind="ranking_method" />
        <p style={{ marginTop: 'var(--mx-space-4)' }}>
          <Link href="/institutions/demo">See an example institution page</Link>
          {' · '}
          <Link href="/questions">Read questions students actually asked</Link>
        </p>
      </div>
    </main>
  );
}
