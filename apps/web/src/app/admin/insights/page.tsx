import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { InsightsView, type InsightsData } from '@/components/insights-view';

export const metadata: Metadata = { title: 'Insights', robots: { index: false } };

/**
 * The insights console (Phase 8, #20).
 *
 * One API call, not six. Every figure on the page has to describe the same
 * instant: a funnel fetched a few seconds before a queue depth is two snapshots
 * presented as one, and the drop-off it appears to show can be the gap.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window } = await searchParams;
  const days = window === '7' || window === '90' ? window : '30';

  const state = await loadConsole(async (token): Promise<InsightsData> =>
    consoleGet<InsightsData>(`/admin/insights?window=${days}`, token),
  );

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="Insights aggregates applications, documents and the register. Confirm it is you before entering."
        action="console_entry"
        ttlMinutes={state.session?.stepUp.ttlMinutes ?? 15}
      />
    );
  }

  if (state.status !== 'ready') {
    return (
      <ConsoleFallback state={state.status} message={'message' in state ? state.message : undefined} />
    );
  }

  return <InsightsView session={state.session} data={state.data} />;
}
