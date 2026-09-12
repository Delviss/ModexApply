import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import { UniversityPortalView, type UniversityPortalData } from '@/components/university-portal-view';

export const metadata: Metadata = { title: 'University portal', robots: { index: false } };

/**
 * The partner's own workspace (FR-017).
 *
 * Everything this page can see is scoped to the caller's institution by the
 * API, and asking for another institution's id is refused and audited rather
 * than quietly re-scoped.
 */
export default async function Page() {
  const state = await loadConsole(async (token): Promise<UniversityPortalData> => {
    const [dashboard, applications, guides] = await Promise.all([
      consoleGet<UniversityPortalData['dashboard']>('/admin/university/dashboard', token),
      consoleGet<{ data: UniversityPortalData['applications'] }>(
        '/admin/university/applications',
        token,
      ),
      consoleGet<{ data: UniversityPortalData['guides'] }>('/admin/university/guides', token),
    ]);
    return { dashboard, applications: applications.data, guides: guides.data };
  });

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="The university portal shows every application made to your institution. Confirm it is you before entering."
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

  return <UniversityPortalView session={state.session} data={state.data} />;
}
