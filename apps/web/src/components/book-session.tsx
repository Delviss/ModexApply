'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, SlotPicker, type BookableSlot } from '@modex/ui';
import type { GuideTopic } from '@modex/contracts';

export interface BookableSlotPayload {
  id: string;
  startsAt: string;
  endsAt: string;
  topics: GuideTopic[];
  bookable: boolean;
  blockedReason: string | null;
}

/**
 * Booking a session.
 *
 * The client never decides whether a slot is free — it renders what the API
 * says and posts an id. Capacity is settled server-side under a row lock, so
 * the losing half of a race gets a clear "somebody just took that time" rather
 * than a double booking.
 */
export function BookSession({
  guideId,
  slots,
}: {
  guideId: string;
  slots: BookableSlotPayload[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  async function book(slotId: string): Promise<void> {
    setError(null);
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, channel: 'video', durationMinutes: 30 }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? 'We could not book that time.');
      // Re-read the calendar: the most likely reason is that it is now taken.
      router.refresh();
      return;
    }

    setBooked(slotId);
    router.refresh();
  }

  return (
    <div className="mx-book-session" data-guide={guideId}>
      {booked === null ? null : (
        <Alert tone="success" title="Your session is booked">
          You will get the joining link from Modex. Guides never ask for payment, and a
          session is never a step in your application.
        </Alert>
      )}
      {error === null ? null : (
        <Alert tone="warning" title="That time is no longer free">
          {error}
        </Alert>
      )}
      <SlotPicker slots={slots as BookableSlot[]} onBook={book} />
    </div>
  );
}
