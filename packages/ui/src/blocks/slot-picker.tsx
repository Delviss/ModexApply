'use client';

import { useMemo, useState } from 'react';
import { GUIDE_TOPIC_LABELS, type GuideTopic } from '@modex/contracts';
import { Button } from '../primitives/button.js';
import { Badge } from '../primitives/badge.js';
import { CalendarIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * Session booking — `@shadcnspace/calendar-03` (day list + slot list) with
 * `@cnippet-dev/v-calendar-8`'s greying of past and fully-booked days, rebuilt
 * on the tokens.
 *
 * The greying is the substantive part, not decoration: the platform prevents
 * overbooking, and a calendar that offers a full slot and then refuses the
 * booking has moved a rule the platform enforces into an error the student
 * discovers. Every unavailable slot is rendered, disabled, with the reason
 * beside it.
 *
 * Times are rendered in the reader's own timezone — via `Intl`, with the zone
 * named on screen, because a student in Lagos booking a call with a guide in
 * Manchester is the normal case here, not the edge one.
 */
export interface BookableSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  topics: GuideTopic[];
  bookable: boolean;
  blockedReason: string | null;
}

export interface SlotPickerProps {
  slots: readonly BookableSlot[];
  onBook?: (slotId: string) => void | Promise<void>;
  /** Overrides the reader's zone, for tests and for a stable render. */
  timeZone?: string;
  locale?: string;
  className?: string;
}

export function SlotPicker({ slots, onBook, timeZone, locale = 'en-GB', className }: SlotPickerProps) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = useMemo(() => groupByDay(slots, zone, locale), [slots, zone, locale]);
  const [selectedDay, setSelectedDay] = useState<string | null>(days[0]?.key ?? null);
  const [booking, setBooking] = useState<string | null>(null);

  if (days.length === 0) {
    return (
      <p className={cn('mx-slots__empty', className)}>
        This guide has not offered any times yet. Send them a message instead — most questions
        never need a call.
      </p>
    );
  }

  const active = days.find((day) => day.key === selectedDay) ?? days[0];

  return (
    <div className={cn('mx-slots', className)}>
      <div className="mx-slots__days" role="tablist" aria-label="Days with available times">
        {days.map((day) => {
          const selected = day.key === active?.key;
          return (
            <button
              key={day.key}
              type="button"
              role="tab"
              id={`mx-slot-day-${day.key}`}
              aria-selected={selected}
              aria-controls={`mx-slot-panel-${day.key}`}
              tabIndex={selected ? 0 : -1}
              className="mx-slots__day"
              data-selected={selected}
              data-empty={day.available === 0}
              onClick={() => setSelectedDay(day.key)}
            >
              <span className="mx-slots__day-label">{day.label}</span>
              <span className="mx-slots__day-count">
                {day.available === 0 ? 'Fully booked' : `${day.available} free`}
              </span>
            </button>
          );
        })}
      </div>

      {active === undefined ? null : (
        <div
          className="mx-slots__list"
          role="tabpanel"
          id={`mx-slot-panel-${active.key}`}
          aria-labelledby={`mx-slot-day-${active.key}`}
        >
          <p className="mx-slots__zone">
            <CalendarIcon size={14} /> Times shown in {zone.replace(/_/g, ' ')}
          </p>
          <ul>
            {active.slots.map((slot) => (
              <li key={slot.id} data-bookable={slot.bookable}>
                <span className="mx-slots__time">
                  <time dateTime={slot.startsAt}>{formatTime(slot.startsAt, zone, locale)}</time>
                  {' – '}
                  <time dateTime={slot.endsAt}>{formatTime(slot.endsAt, zone, locale)}</time>
                </span>
                {slot.topics.length > 0 ? (
                  <span className="mx-slots__topics">
                    {slot.topics.map((topic) => (
                      <Badge key={topic} tone="neutral">
                        {GUIDE_TOPIC_LABELS[topic]}
                      </Badge>
                    ))}
                  </span>
                ) : null}
                {slot.bookable ? (
                  <Button
                    size="sm"
                    disabled={booking !== null}
                    onClick={async () => {
                      setBooking(slot.id);
                      try {
                        await onBook?.(slot.id);
                      } finally {
                        setBooking(null);
                      }
                    }}
                  >
                    Book
                  </Button>
                ) : (
                  // Disabled *and* explained. A greyed control with no reason is
                  // indistinguishable from a broken one.
                  <span className="mx-slots__blocked">{slot.blockedReason ?? 'Unavailable'}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface DayGroup {
  key: string;
  label: string;
  available: number;
  slots: BookableSlot[];
}

function groupByDay(slots: readonly BookableSlot[], timeZone: string, locale: string): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const date = new Date(slot.startsAt);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(date);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        key,
        label: new Intl.DateTimeFormat(locale, {
          timeZone,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(date),
        available: slot.bookable ? 1 : 0,
        slots: [slot],
      });
      continue;
    }
    existing.slots.push(slot);
    if (slot.bookable) existing.available += 1;
  }
  return [...groups.values()];
}

function formatTime(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
