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
  /** Show the fasting timer on Today, and the goal a new fast starts with. */
  fasting: boolean;
  fastingGoalHours: number;
  /** Higher days (1 = Monday … 7 = Sunday) that get `shiftKcal` more; the other days get less, so the week stays the same. */
  shiftDays: number[];
  shiftKcal: number;
  /** The day's target per meal in %, adding up to 100; empty for no meal targets. */
  mealShares: { mealId: number; pct: number }[];
  updatedAt?: string;
}

export interface AppInfo {
  aiConfigured: boolean;
  /** Your Picnic account is linked (optional, experimental). */
  picnicLinked: boolean;
  aiProvider: string;
  aiModel: string;
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

export type ProductSource = 'off' | 'nevo' | 'custom' | 'recipe' | 'picnic';
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
  quick?: { name: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null; aiEstimate?: boolean } | null;
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

/** One food of a saved meal, ready to log: values from its product as it is now, or its own when that is gone. */
export interface SavedMealItem extends Omit<EntryInput, 'day' | 'mealId'> {
  id: number;
  name: string;
  brand: string;
  source: ProductSource | null;
  quantity: number;
  nutrients: Nutrients;
  aiEstimate: boolean;
}

/** A fixed set of foods ("my breakfast") logged in one tap. */
export interface SavedMeal {
  id: number;
  name: string;
  items: SavedMealItem[];
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
  /** The target per meal, when you set shares per meal. */
  meals: { mealId: number; kcal: number; proteinG: number }[];
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

/** A fast: running while `endedAt` is null. Times are instants (ISO). */
export interface Fast {
  id: number;
  startedAt: string;
  endedAt: string | null;
  goalHours: number;
  /** Hours so far (running) or in total (ended). */
  hours: number;
  reached: boolean;
}

export interface FastingState {
  current: Fast | null;
  /** The last ended fasts, newest first. */
  recent: Fast[];
}

/** One week (Monday to Sunday) looked back on. Averages count only complete logged days up to today. */
export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  /** The week before; the week after, unless that is still to come. */
  previous: string;
  next: string | null;
  days: ProgressDay[];
  /** Days with something logged (also incomplete ones), and of those the complete ones. */
  loggedDays: number;
  completeDays: number;
  /** Days of the week up to today. */
  daysSoFar: number;
  avgKcal: number | null;
  avgTargetKcal: number | null;
  /** Eaten minus target, added up over the complete days: below zero is under target. */
  balanceKcal: number | null;
  avgProteinG: number | null;
  avgCarbsG: number | null;
  avgFatG: number | null;
  /** Complete days that reached at least 95 % of the protein target, out of the complete days with a target. */
  proteinHitDays: number;
  proteinTargetDays: number;
  trainingDays: number;
  /** Trend weight at the start and end of the week, and the change. */
  trendStartKg: number | null;
  trendEndKg: number | null;
  trendChangeKg: number | null;
  weighIns: number;
  /** What gave the most energy this week. */
  topFoods: { name: string; kcal: number; times: number }[];
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

// ---------- AI ----------

export type AiProviderId = 'anthropic' | 'openai';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AiFeature = 'parse' | 'photo' | 'label' | 'coach' | 'test';

/** AI settings as the settings page sees them. The API key itself is never sent to the browser. */
export interface AiSettingsView {
  provider: AiProviderId;
  model: string;
  /** Only for OpenAI-compatible servers (Ollama, LM Studio, ...); empty means the provider default. */
  baseUrl: string;
  /** Where the key comes from: saved in the app, the server environment, or nowhere. */
  keySource: 'app' | 'env' | null;
  /** Last characters of the key, e.g. "…a1b2". */
  keyHint: string | null;
  /** null means: let the model use its own default. */
  coachEffort: Effort | null;
  /** Reading a meal from text or a photo. */
  parseEffort: Effort | null;
  /** Stop AI calls once this month's estimated cost reaches this (USD). null means no limit. */
  monthlyBudgetUsd: number | null;
  /** Keep meal photos after they were read. */
  storePhotos: boolean;
  configured: boolean;
  /** Known Claude models with their list price per million tokens. */
  models: { id: string; label: string; inputUsd: number; outputUsd: number }[];
}

export interface AiSettingsUpdate {
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  /** A new key, or null to remove the key saved in the app (the server key then applies again). */
  apiKey?: string | null;
  coachEffort?: Effort | null;
  parseEffort?: Effort | null;
  monthlyBudgetUsd?: number | null;
  storePhotos?: boolean;
}

export interface AiUsageEntry {
  id: number;
  createdAt: string;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated from the list price; null when the price is unknown (e.g. a local model). */
  costUsd: number | null;
  ok: boolean;
  error: string | null;
}

export interface AiUsageSummary {
  month: { start: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; failed: number };
  previousMonthCostUsd: number;
  budgetUsd: number | null;
  byFeature: { feature: AiFeature; calls: number; costUsd: number; inputTokens: number; outputTokens: number }[];
  daily: { day: string; costUsd: number; calls: number }[];
  recent: AiUsageEntry[];
  /** True when some calls used a model without a known price. */
  hasUnpricedCalls: boolean;
}

/** A change to the phase the coach suggests; it only takes effect through the target engine and your confirmation. */
export interface PhaseSuggestion {
  phase: Phase;
  ratePctPerWeek: number;
}

export interface CoachMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  suggestion: PhaseSuggestion | null;
  createdAt: string;
}

/** One food the AI read from your text or photo, matched to products here. */
export interface MealLine {
  /** What the AI called it. */
  name: string;
  /** The AI's guess of the amount, in grams (ml for drinks). */
  grams: number;
  /** Matches from the normal search, best first. */
  candidates: Product[];
  /** The AI's own estimate of the nutrients for this amount; used only when you pick no product. */
  estimate: { kcal: number; protein: number | null; carbs: number | null; fat: number | null } | null;
}

export interface MealProposal {
  lines: MealLine[];
}

/** A nutrition label read from a photo: values per 100 g or ml, to check in the product form before saving. */
export interface LabelReading {
  name: string | null;
  brand: string | null;
  unit: BaseUnit;
  per100: Nutrients;
  serving: { label: string; grams: number } | null;
}

// ---------- Picnic (optional, experimental) ----------

export interface PicnicStatus {
  linked: boolean;
  linkedAt: string | null;
  /** Waiting for the 2FA code after a login. */
  awaiting2fa: boolean;
}

/** A product from your recent Picnic deliveries. */
export interface PicnicArticle {
  id: string;
  name: string;
  unitQuantity: string;
  /** In how many of the recent deliveries it was. */
  times: number;
  lastDelivered: string | null;
  /** The product here, once it has been read. */
  productId: number | null;
}

/** Reading a Picnic product: a product when the nutrition values could be read, otherwise a draft to complete. */
export type PicnicImport =
  | { product: Product; draft: null }
  | { product: null; draft: { name: string; brand: string; unit: 'g' | 'ml'; nutritionText: string | null } };
