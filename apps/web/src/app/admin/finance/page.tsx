import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { FinanceConsoleView, type FinanceConsoleData } from '@/components/finance-console-view';

export const metadata: Metadata = { title: 'Finance console', robots: { index: false } };

/** The finance console (Phase 6 §4). */
export default async function Page() {
  const state = await loadConsole(async (token): Promise<FinanceConsoleData> => {
    const [rewards, payouts, settlement] = await Promise.all([
      consoleGet<{ data: FinanceConsoleData['rewards'] }>('/admin/finance/rewards', token),
      consoleGet<{ data: FinanceConsoleData['payouts'] }>('/admin/finance/payouts', token),
      consoleGet<FinanceConsoleData['settlement']>('/admin/finance/settlement', token),
    ]);
    return { rewards: rewards.data, payouts: payouts.data, settlement };
  });

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="The finance console moves money. Confirm it is you before entering."
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

  return <FinanceConsoleView session={state.session} data={state.data} />;
}
