import { decimal, locale, t } from './i18n.ts';

/** "v1.2.3" for a release, "dev-abc1234" as it is for other builds. */
export function versionLabel(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

/** A number with at most `digits` decimals: 42.5 in English, 42,5 in Dutch. */
export function num(n: number, digits = 1): string {
  return decimal(String(Math.round(n * 10 ** digits) / 10 ** digits));
}

export function kg(weight: number): string {
  return num(weight, 1);
}

/** Energy is always whole kilocalories. */
export function kcal(n: number): string {
  return `${Math.round(n)} kcal`;
}

/** kJ for display next to kcal (1 kcal = 4.184 kJ). */
export function kj(kcalValue: number): string {
  return `${Math.round(kcalValue * 4.184)} kJ`;
}

/** +1.2 / −0.4 / ±0 with the given number format. */
export function signed(n: number, format: (x: number) => string): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${format(Math.abs(n))}`;
}

/** Grams of a macro: whole grams from 10 g, one decimal below. */
export function grams(n: number): string {
  return `${n >= 10 ? Math.round(n) : num(n, 1)} g`;
}

/** YYYY-MM-DD as a short local date ("27 Nov"). Parsed as a calendar date, so no time zone shift. */
export function shortDate(day: string): string {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** YYYY-MM-DD as "Friday 27 November". */
export function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** YYYY-MM-DD as a short day for a chip ("Sat 29" / "za 29"). */
export function chipDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A YYYY-MM-DD date moved by whole calendar days. */
export function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today / Yesterday / Tomorrow, else the long date. `today` comes from the server (the profile's time zone). */
export function dayLabel(day: string, today: string): string {
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return t('Today', 'Vandaag');
  if (diff === -1) return t('Yesterday', 'Gisteren');
  if (diff === 1) return t('Tomorrow', 'Morgen');
  return longDate(day);
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${decimal((n / 1_000_000).toFixed(1))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${decimal((n / 1000).toFixed(1))}k`;
  return String(Math.round(n));
}
