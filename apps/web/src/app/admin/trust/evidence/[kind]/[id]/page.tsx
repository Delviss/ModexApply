import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { EvidenceView, type EvidencePayload } from '@/components/evidence-view';

export const metadata: Metadata = { title: 'Evidence', robots: { index: false } };

/**
 * Verification evidence — **and the page that makes looking at it an event.**
 *
 * Its own route, its own step-up, and an audit record written server-side
 * before a single row comes back. The notice the view renders is not a
 * formality: an operator who knows their look is recorded behaves differently
 * from one who does not, and the second behaviour is what this page is for.
 */
export default async function EvidencePage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (kind !== 'institution' && kind !== 'guide') notFound();

  const state = await loadConsole(
    async (token): Promise<EvidencePayload> =>
      kind === 'institution'
        ? {
            kind: 'institution',
            payload: await consoleGet(`/admin/trust/institutions/${id}/evidence`, token),
          }
        : {
            kind: 'guide',
            payload: await consoleGet(`/admin/trust/guides/${id}/evidence`, token),
          },
  );

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="You are about to open verification evidence. The fact that you looked, and at whose records, is recorded against your name."
        action="evidence_view"
        ttlMinutes={state.session?.stepUp.ttlMinutes ?? 15}
      />
    );
  }

  if (state.status !== 'ready') {
    return (
      <ConsoleFallback
        state={state.status}
        message={'message' in state ? state.message : undefined}
      />
    );
  }

  return <EvidenceView session={state.session} data={state.data} />;
}
