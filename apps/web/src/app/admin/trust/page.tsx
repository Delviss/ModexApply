import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { TrustConsoleView, type TrustConsoleData } from '@/components/trust-console-view';

export const metadata: Metadata = { title: 'Trust console', robots: { index: false } };

/**
 * The Trust console (Phase 6 §2).
 *
 * The page fetches; `<TrustConsoleView>` renders. The split is not cosmetic:
 * the session token is read from an httpOnly cookie here and must never cross
 * into the browser bundle, and the tables over there take render functions,
 * which a server component cannot hand to a client one.
 */
export default async function Page() {
  const state = await loadConsole(async (token): Promise<TrustConsoleData> => {
    const [summary, queue, signals, cases] = await Promise.all([
      consoleGet<TrustConsoleData['summary']>('/admin/trust/summary', token),
      consoleGet<TrustConsoleData['queue']>('/admin/trust/queue', token),
      consoleGet<TrustConsoleData['signals']>('/admin/trust/signals?days=7', token),
      consoleGet<{ data: TrustConsoleData['cases'] }>('/trust/cases?state=open', token),
    ]);
    return { summary, queue, signals, cases: cases.data };
  });

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="The Trust console holds verification evidence, reports and sanctions. Confirm it is you before entering."
        action="console_entry"
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

  return <TrustConsoleView session={state.session} data={state.data} />;
}
