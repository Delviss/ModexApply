import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { OpsConsoleView, type OpsConsoleData } from '@/components/ops-console-view';

export const metadata: Metadata = { title: 'Operations console', robots: { index: false } };

/** The operations console (Phase 6 §3). */
export default async function Page() {
  const state = await loadConsole(async (token): Promise<OpsConsoleData> => {
    const [connectors, exceptions, catalogue, impersonations] = await Promise.all([
      consoleGet<{ data: OpsConsoleData['connectors'] }>('/admin/ops/connectors', token),
      consoleGet<OpsConsoleData['exceptions']>('/admin/ops/exceptions', token),
      consoleGet<OpsConsoleData['catalogue']>('/admin/ops/catalogue', token),
      consoleGet<{ data: OpsConsoleData['impersonations'] }>('/admin/ops/impersonations', token),
    ]);
    return {
      connectors: connectors.data,
      exceptions,
      catalogue,
      impersonations: impersonations.data,
    };
  });

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="The operations console can enable connectors and start support sessions inside student accounts. Confirm it is you before entering."
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

  return <OpsConsoleView session={state.session} data={state.data} />;
}
