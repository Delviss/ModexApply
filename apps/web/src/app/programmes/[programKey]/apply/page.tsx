import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardHeader, DisclosureNotice } from '@modex/ui';
import { deriveIntakeStatus } from '@modex/contracts';
import { ApiError, MONEY_REVALIDATE_SECONDS, apiGet, type PublicProgramme } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { StartApplication, type StartableIntake } from '@/components/start-application';

export const metadata: Metadata = {
  title: 'Start an application',
  robots: { index: false },
};

/**
 * The step between a programme page and an application.
 *
 * It exists to make the intake an explicit choice rather than an inference.
 * "One application per programme/intake" is a database constraint, so picking
 * the wrong intake is not a mistake a student can undo by starting again — and
 * a page that guessed for them would produce exactly that.
 */
export default async function StartApplicationPage({
  params,
}: {
  params: Promise<{ programKey: string }>;
}) {
  const { programKey } = await params;

  const token = await sessionToken();
  if (token === null) redirect(`/login?next=/programmes/${programKey}/apply`);

  let programme: PublicProgramme;
  try {
    // Carries a deadline, so it takes the short read window rather than the
    // inherited default: an intake that closed a minute ago must not still be
    // offered as somewhere to start an application.
    programme = await apiGet<PublicProgramme>(
      `/programmes/${encodeURIComponent(programKey)}/public`,
      { revalidate: MONEY_REVALIDATE_SECONDS },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const intakes: StartableIntake[] = programme.intakes.map((intake) => {
    const status = deriveIntakeStatus({
      applicationDeadline: intake.applicationDeadline,
      startDate: intake.startDate,
      status: intake.status as 'scheduled' | 'open' | 'closing_soon' | 'closed' | 'cancelled',
    });
    return {
      id: intake.id,
      label: `Starts ${formatDate(intake.startDate)}`,
      hint: `Apply by ${formatDate(intake.applicationDeadline)}`,
      open: status === 'open' || status === 'closing_soon',
    };
  });

  return (
    <main className="mx-applications">
      <header>
        <p className="mx-card__description">
          <Link href={`/programmes/${programKey}`}>Back to the programme</Link>
        </p>
        <h1 className="mx-card__title">Apply to {programme.program.name}</h1>
        <p className="mx-card__description">
          {programme.program.institution.displayName}, {programme.program.institution.country}
        </p>
      </header>

      <Card padding="lg">
        <CardHeader
          title="Pick an intake"
          description="You can hold one application per intake. A different intake of the same programme is a separate application."
        />
        <StartApplication programKey={programKey} intakes={intakes} />
      </Card>

      <DisclosureNotice kind="commission" />
    </main>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
