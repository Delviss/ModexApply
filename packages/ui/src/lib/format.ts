/** Date formatting used by provenance stamps and deadlines. */
export function formatDate(value: string | Date | null, locale = 'en-GB'): string {
  if (value === null) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** "3 days ago" / "in 12 days" — used for freshness and deadline copy. */
export function formatRelative(value: string | Date | null, now = new Date(), locale = 'en-GB'): string {
  if (value === null) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(deltaSeconds, 'second');
}

/**
 * The day divider in a chat thread: "Today", "Yesterday", or the date.
 *
 * The grouping itself is in the contracts package and is UTC, so a reader who
 * changes timezone does not see their messages regroup. Only the *label* is
 * local, which is the half a reader is entitled to see in their own terms.
 */
export function formatDayDivider(day: string, now = new Date(), locale = 'en-GB'): string {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00.000Z`));
}
