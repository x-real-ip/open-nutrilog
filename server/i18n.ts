// User-facing text on the server comes in English and Dutch; the profile picks one (default English).
// Text that is stored (target explanations, meal names) keeps both languages as JSON, so
// switching language also applies to what is already in the database.
import type { Language, Profile } from '../shared/types.ts';

export type Lang = Language;

export interface Localized {
  en: string;
  nl: string;
}

export const loc = (en: string, nl: string): Localized => ({ en, nl });

export function langOf(profile: Pick<Profile, 'language'> | null | undefined): Lang {
  return profile?.language ?? 'en';
}

/** Serialize for a text column. */
export function encode(text: Localized): string {
  return JSON.stringify(text);
}

/** Text in the given language: a Localized value, its JSON form, or plain (older, untranslated) text. */
export function pick(text: Localized | string | null | undefined, lang: Lang): string {
  if (!text) return '';
  if (typeof text !== 'string') return text[lang];
  if (text.startsWith('{"en"')) {
    try {
      const parsed = JSON.parse(text) as Localized;
      if (typeof parsed.en === 'string' && typeof parsed.nl === 'string') return parsed[lang];
    } catch {
      // Not ours: plain text that happens to start like JSON.
    }
  }
  return text;
}

/** Error with a message in both languages; the error handler picks the profile's language. */
export class UserError extends Error {
  status: number;
  text: Localized;
  constructor(status: number, en: string, nl: string) {
    super(en);
    this.status = status;
    this.text = { en, nl };
  }
}

/** A number with at most `digits` decimals: 42.5 in English, 42,5 in Dutch. */
export function formatNumber(n: number, lang: Lang, digits = 1): string {
  const text = String(Math.round(n * 10 ** digits) / 10 ** digits);
  return lang === 'nl' ? text.replace('.', ',') : text;
}

/** "42.5 kg" in English, "42,5 kg" in Dutch. */
export function formatKg(weight: number, lang: Lang): string {
  return `${formatNumber(weight, lang)} kg`;
}

/** "1982 kcal"; energy is always shown as whole kilocalories. */
export function formatKcal(kcal: number): string {
  return `${Math.round(kcal)} kcal`;
}

/** Name of the language for AI prompts. */
export const AI_LANGUAGE: Record<Lang, string> = { en: 'English', nl: 'Dutch' };
