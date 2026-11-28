// Shared types between server and web client.
// Keep this file free of runtime code so both sides can import it as types only.
import type { BaseUnit, EntryUnit, NutrientKey, Nutrients, Serving } from './nutrition.ts';

/** Language of everything the user sees; English by default. */
export type Language = 'en' | 'nl';

export type AuthMode = 'none' | 'password' | 'proxy' | 'oidc';

export type Sex = 'male' | 'female';
export type Phase = 'cut' | 'maintain' | 'bulk';

export interface Profile {
  name: string;
  language: Language;
  /** IANA time zone that decides what "a day" is; empty means the server default (TZ, else Europe/Amsterdam). */
  timeZone: string;
  /** For the BMR formula. Targets need sex, age, height and weight. */
  sex: Sex | null;
  age: number | null;
  heightCm: number | null;
  /** Follows the latest weigh-in; editing it here also logs today's weight. */
  weightKg: number | null;
  /** Activity outside training (1.2, 1.4, 1.55 or 1.7); training itself is added per training day. */
  neat: number;
  phase: Phase;
  /** % of body weight per week; capped at 1 for a cut and 0.5 for a bulk. */
  ratePctPerWeek: number;
  /** null: 2.0 g/kg on a cut, 1.8 otherwise. */
  proteinGPerKg: number | null;
  /** Training-day energy goes to carbohydrates. */
  carbCycling: boolean;
  metStrength: number;
  /** Expected length of a training, used when you mark a day as a training day before the workout. */
  trainingMinutes: number;
  /** How much of the workout energy counts: 0, 50 or 100 %. */
  workoutEnergyShare: number;
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

export type ProductSource = 'off' | 'nevo' | 'custom' | 'recipe';
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
  /** For a recipe: the number of portions (its one serving is a portion). */
  portions: number | null;
}

export interface RecipeIngredient {
  productId: number;
  name: string;
  brand: string;
  source: ProductSource;
  amount: number;
  unit: 'g' | 'ml' | 'serving';
  servingLabel: string | null;
  /** Grams (or ml). */
  quantity: number;
  kcal: number;
}

export interface Recipe {
  product: Product;
  portions: number;
  /** Weight after cooking; null: the ingredients added up. */
  cookedWeightG: number | null;
  /** The weight the values per 100 g are based on. */
  totalWeightG: number;
  ingredients: RecipeIngredient[];
  perPortion: Nutrients;
}

export interface RecipeInput {
  name: string;
  portions: number;
  cookedWeightG: number | null;
  ingredients: { productId: number; amount: number; unit: 'g' | 'ml' | 'serving'; servingLabel?: string | null }[];
}

/** Where the food data comes from, for the About / sources page. */
export interface SourcesInfo {
  nevo: { version: string; importedAt: string; count: number; attribution: string } | null;
  off: { products: number; lastImport: { at: string; imported: number } | null };
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

// ---------- Targets and progress ----------

export interface DayMark {
  /** true: training day (also before the workout), false: not a training day, null: automatic. */
  training: boolean | null;
  /** The diary of this day is not complete; the adaptive maintenance leaves it out. */
  incomplete: boolean;
}

export interface TargetStep {
  id: string;
  kcal: number | null;
  text: string;
}

export interface DayTarget {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  bmr: number;
  base: number;
  baseSource: 'formula' | 'adaptive';
  phaseAdjust: number;
  restKcal: number;
  workoutKcal: number;
  isTrainingDay: boolean;
  floorHit: boolean;
  workout: { minutes: number; source: 'finished' | 'in_progress' | 'planned' } | null;
  steps: TargetStep[];
}

export interface AdaptiveView {
  status: 'ok' | 'not_enough';
  base: number;
  formulaBase: number;
  loggedDays: number;
  weighIns: number;
  spanDays: number;
  text: string;
}

export interface TargetResponse {
  day: string;
  target: DayTarget | null;
  /** Profile fields still needed for a target. */
  missing: ('sex' | 'age' | 'heightCm' | 'weightKg')[];
  mark: DayMark;
  adaptive: AdaptiveView | null;
}

export interface BodyWeightEntry {
  id: number;
  date: string;
  weightKg: number;
}

export interface ProgressDay {
  date: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  logged: boolean;
  incomplete: boolean;
  targetKcal: number | null;
  isTrainingDay: boolean;
}

export interface ProgressResponse {
  days: ProgressDay[];
  weights: { date: string; weightKg: number; trendKg: number }[];
  /** Trend weight now minus a week ago. */
  weeklyChangeKg: number | null;
  weeks: { weekStart: string; avgKcal: number | null; avgTargetKcal: number | null; loggedDays: number }[];
  /** Over the last 7 complete logged days. */
  averages: { days: number; kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
  tdee: { weekStart: string; baseKcal: number; formulaKcal: number; adaptiveKcal: number | null }[];
}

// ---------- Open Strength ----------

/** The link with Open Strength, for the PWA (GET /api/linked/strength). */
export interface LinkedStrength {
  status: 'off' | 'ok' | 'unreachable';
  profile: { goal: 'hypertrophy' | 'strength' | 'conditioning' | 'fat_loss'; level: string; age: number; heightCm: number; weightKg: number; language: Language } | null;
  todayWorkouts: { id: number; status: 'in_progress' | 'completed'; durationMinutes: number; dayName: string; totalSets: number; volumeKg: number }[];
  clash: string | null;
  /** Weigh-ins waiting to be sent. */
  pendingWeights: number;
}
