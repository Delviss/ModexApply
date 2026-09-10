import Link from 'next/link';
import { Card, CardHeader, EligibilityExplanation } from '@modex/ui';
import type { EligibilityExplanation as Explanation } from '@modex/contracts';
import { apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * The eligibility panel on a programme page (Phase 2 §4).
 *
 * Three states, and the distinction between them is the product rule:
 *
 *  - **Signed out** — an invitation, with no verdict of any kind. An absence
 *    must never read as a rejection, and the safest way to guarantee that is to
 *    render no outcome at all rather than a neutral-looking one.
 *  - **Signed in** — the full explanation, every rule with its source, so a
 *    wrong requirement can be contested.
 *  - **Check failed** — says the check failed. Not "not eligible", which is a
 *    claim about the student rather than about our systems.
 */
export async function EligibilityPanel({ programKey }: { programKey: string }) {
  const token = await sessionToken();

  if (token === null) {
    return (
      <Card padding="lg">
        <CardHeader
          title="Can you apply for this?"
          description="Sign in and complete your profile to see, requirement by requirement, which of these you already meet. We show you the reasoning, not a score."
        />
        <p className="mx-eligibility__meta">
          <Link href={`/login?next=/programmes/${programKey}`}>Sign in</Link> — Modex does not
          make admission decisions. The university does.
        </p>
      </Card>
    );
  }

  let explanation: Explanation | null = null;
  try {
    explanation = await apiGetAs<Explanation>(`/programmes/${programKey}/eligibility`, token);
  } catch {
    explanation = null;
  }

  return (
    <Card padding="lg">
      {explanation === null ? (
        <CardHeader
          title="We could not run your eligibility check"
          description="Something went wrong on our side. This is not a result about your eligibility for this programme — try again shortly."
        />
      ) : (
        <EligibilityExplanation explanation={explanation} />
      )}
    </Card>
  );
}
