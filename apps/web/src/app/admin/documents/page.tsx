import type { Metadata } from 'next';
import { consoleGet, loadConsole } from '@/lib/console';
import { ConsoleFallback } from '@/components/console-fallback';
import { StepUpGate } from '@/components/console-chrome';
import {
  DocumentReviewView,
  type DocumentReviewData,
  type QueueRow,
  type QueueSummary,
} from '@/components/document-review-view';

export const metadata: Metadata = { title: 'Document assessment', robots: { index: false } };

/**
 * The document assessment console (Phase 8, #20).
 *
 * The queue is fetched here so the session token never reaches the browser; the
 * view gets plain JSON. Opening a document is a *separate* call the reviewer
 * makes deliberately, which is why nothing in this fetch returns file contents
 * or a download URL.
 */
export default async function Page() {
  const state = await loadConsole(async (token): Promise<DocumentReviewData> => {
    const queue = await consoleGet<{ data: QueueRow[]; summary: QueueSummary }>(
      '/admin/documents/queue?state=all',
      token,
    );
    return { rows: queue.data, summary: queue.summary };
  });

  if (state.status === 'step_up_required') {
    return (
      <StepUpGate
        purpose="Document assessment shows files students uploaded in support of an application. Confirm it is you before entering."
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

  return <DocumentReviewView session={state.session} data={state.data} />;
}
