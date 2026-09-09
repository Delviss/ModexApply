import type { Metadata } from 'next';
import { Card, CardHeader } from '@modex/ui';
import { OnboardingWizard } from '@/components/onboarding-wizard';

export const metadata: Metadata = {
  title: 'Partner onboarding',
  description: 'Start a partnership with Modex Apply.',
  robots: { index: false },
};

export default function OnboardingPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--mx-space-12) var(--mx-space-6)' }}>
      <Card padding="lg" style={{ marginBottom: 'var(--mx-space-6)' }}>
        <CardHeader
          title="Become a partner university"
          description="Five short steps, then a Modex trust review. We verify every institution the same way, and we publish nothing about you until the partnership is active."
        />
      </Card>
      <OnboardingWizard />
    </main>
  );
}
