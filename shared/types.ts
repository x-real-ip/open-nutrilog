// Shared types between server and web client.
// Keep this file free of runtime code so both sides can import it as types only.
import type { BaseUnit, EntryUnit, NutrientKey, Nutrients, Serving } from './nutrition.ts';

/** Language of everything the user sees; English by default. */
export type Language = 'en' | 'nl';

export type AuthMode = 'none' | 'password' | 'proxy' | 'oidc';

export interface Profile {
  name: string;
  language: Language;
  /** IANA time zone that decides what "a day" is; empty means the server default (TZ, else Europe/Amsterdam). */
  timeZone: string;
  updatedAt?: string;
}

export interface AppInfo {
  authMode: AuthMode;
  authRequired: boolean;
  authenticated: boolean;
  user: { username: string; email?: string; name?: string } | null;
  oidcProviderName: string;
  version: string;
  /** The profile's language (English until a profile says otherwise). */
  language: Language;
  /** The time zone in use (profile, else the server default). */
  timeZone: string;
  /** Today in that time zone, YYYY-MM-DD. */
  today: string;
}

// ---------- Food ----------


export type ProductSource = 'off' | 'nevo' | 'custom';
export type ProductPreference = 'favorite' | 'hidden';

export interface Product {
  id: number;
  source: ProductSource;
  /** Name in the profile's language (falls back to the other language). */
  name: string;
  nameEn: string;
  nameNl: string;
  brand: string;
  barcode: string | null;
  /** Values are per 100 of this unit. */
  unit: BaseUnit;
  per100: Nutrients;
  /** Other nutrients from the source, per 100 (e.g. sodium, potassium), with their units. Not shown yet. */
  extra: Record<string, { value: number; unit: string }>;
  servings: Serving[];
  preference: ProductPreference | null;
  /** Set on a local edit of an OFF/NEVO product: the product it overrides. */
  overrideOf: number | null;
  /** NEVO version or OFF fetch date, for the source note. */
  sourceVersion: string | null;
}

/** What you fill in for your own product or a local edit. */
export interface ProductInput {
  nameEn: string;
  nameNl: string;
  brand: string;
  barcode: string | null;
  unit: BaseUnit;
  per100: Nutrients;
  servings: Serving[];
}

export interface ProductLists {
  recent: Product[];
  frequent: Product[];
  favorites: Product[];
  mine: Product[];
  hidden: Product[];
}

// ---------- Diary ----------

export interface Meal {
  id: number;
  name: string;
  position: number;
  hidden: boolean;
}

/** What the app sends to log or change an entry (PUT by a client-made id, so retries are harmless). */
export interface EntryInput {
  day: string;
  mealId: number;
  /** A product, or a quick add (energy and optional macros, no product). */
  productId: number | null;
  amount: number;
  unit: EntryUnit;
  servingLabel?: string | null;
  quick?: { name: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null } | null;
}

export interface DiaryEntry extends EntryInput {
  id: string;
  name: string;
  brand: string;
  source: ProductSource | null;
  /** Grams or ml eaten (0 for a quick add). */
  quantity: number;
  nutrients: Nutrients;
  aiEstimate: boolean;
  createdAt: string;
}

export interface DiaryDay {
  day: string;
  meals: Meal[];
  entries: DiaryEntry[];
  totals: Record<NutrientKey, number>;
}
