'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox } from '@modex/ui';

/**
 * "Message this guide" — and the consent that has to come first.
 *
 * `guide_access` is a separate, revocable grant (Phase 0 §3.2): being signed in
 * is not consent to be put in touch with another person. The checkbox is
 * unticked by default and the button is inert until it is ticked, because a
 * pre-ticked consent box is not consent.
 *
 * The wording shown here is the wording recorded with the grant
 * (`noticeVersion`), so "what did they actually agree to?" has an answer.
 */
const NOTICE_VERSION = 'guide-access-2026-09';

export interface StartConversationProps {
  guideId: string;
  guideName: string;
  contextType?: 'institution' | 'program' | 'general';
  contextId?: string | null;
}

export function StartConversation({
  guideId,
  guideName,
  contextType = 'general',
  contextId = null,
}: StartConversationProps) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const consent = await fetch('/api/consents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'guide_access',
          subjectId: guideId,
          noticeVersion: NOTICE_VERSION,
        }),
      });
      if (!consent.ok) throw new Error('We could not record your consent.');

      const opened = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guideId, contextType, contextId }),
      });
      if (!opened.ok) {
        const body = (await opened.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? 'We could not open that conversation.');
      }

      const thread = (await opened.json()) as { conversation: { id: string } };
      router.push(`/messages?conversation=${thread.conversation.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-start-conversation">
      <p className="mx-card__description">
        {guideName} is a current student, not university staff. They never see your
        documents or your application, and you can stop this at any time.
      </p>
      <Checkbox
        label={`Share my first name with ${guideName} so we can start a conversation`}
        checked={consented}
        onChange={(event) => setConsented(event.target.checked)}
      />
      <Button onClick={start} disabled={!consented || busy}>
        {busy ? 'Opening…' : 'Message this guide'}
      </Button>
      {error === null ? null : (
        <Alert tone="danger" title="We could not start that conversation">
          {error}
        </Alert>
      )}
    </div>
  );
}
