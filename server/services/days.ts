// "A day" is a calendar day in the user's time zone (Europe/Amsterdam by default). Every diary day,
// day total, training day and date range goes through here, so they all agree.

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dayOf(instant: Date | string | number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Today in a time zone. */
export function today(timeZone: string): string {
  return dayOf(new Date(), timeZone);
}

/** A date string shifted by whole days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
