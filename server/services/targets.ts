// The target engine. Calorie and macro targets come from here only: deterministic, pure functions (no database),
// fully unit-tested. The AI never sets targets; it may explain them. Every step carries its own explanation in
// both languages, which "How your target is built" shows as is.
//
// Spec example (kept green in server/tests/targets.test.ts): a man of 80 kg, 180 cm, 40 years, NEAT 1.4, cutting
// 0.5 %/week → BMR 1730, base 2422, cut −440, rest day 1982 kcal; a 45-minute workout at MET 5.0 adds 240 → 2222;
// protein 2.0 g/kg = 160 g.
import { formatNumber, loc, type Localized } from '../i18n.ts';

export type Sex = 'male' | 'female';
export type Phase = 'cut' | 'maintain' | 'bulk';

/** Activity outside training. Training is never in this factor, so it is never counted twice. */
export const NEAT_LEVELS = [1.2, 1.4, 1.55, 1.7] as const;
export const DEFAULT_NEAT = 1.4;
/** Net MET for strength training (Compendium: vigorous resistance training). */
export const DEFAULT_MET = 5;
export const MAX_WORKOUT_MINUTES = 120;
/** Fastest change the engine allows, in % body weight per week. */
export const MAX_RATE: Record<Phase, number> = { cut: 1, maintain: 0, bulk: 0.5 };
export const KCAL_PER_KG = 7700;
export const FAT_MIN_SHARE = 0.25;
/** The adaptive maintenance estimate moves at most this much per week. */
export const MAX_TDEE_STEP = 150;
export const EWMA_ALPHA = 0.1;

export interface Body {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

export interface TargetSettings {
  neat: number;
  phase: Phase;
  ratePctPerWeek: number;
  /** null: 2.0 g/kg on a cut, 1.8 otherwise. */
  proteinGPerKg: number | null;
  /** Training-day energy goes to carbs (on) or is shared out like the rest of the day (off). */
  carbCycling: boolean;
  metStrength: number;
  /** How much of the workout energy counts: 0, 50 or 100 %. */
  workoutEnergyShare: number;
}

export interface Workout {
  minutes: number;
  /** A finished workout from Open Strength, one in progress, or a day you marked as "training today". */
  source: 'finished' | 'in_progress' | 'planned';
}

export interface Step {
  id: 'bmr' | 'base' | 'adaptive' | 'phase' | 'floor' | 'workout' | 'protein' | 'fat' | 'carbs';
  kcal: number | null;
  text: Localized;
}

export interface Target {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  bmr: number;
  /** Maintenance without training: the formula, or the adaptive estimate once there is enough data. */
  base: number;
  baseSource: 'formula' | 'adaptive';
  phaseAdjust: number;
  /** The target without training: what a rest day gets. */
  restKcal: number;
  workoutKcal: number;
  isTrainingDay: boolean;
  floorHit: boolean;
  steps: Step[];
}

const n = (v: number, d = 0) => ({ en: formatNumber(v, 'en', d), nl: formatNumber(v, 'nl', d) });
const kcalText = (v: number) => n(Math.round(v));

export function bmr(b: Body): number {
  return 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === 'male' ? 5 : -161);
}

/** The rate the engine uses: 0 when maintaining, otherwise capped at 1 %/week for a cut and 0.5 %/week for a bulk. */
export function effectiveRate(phase: Phase, rate: number): number {
  return Math.min(Math.max(rate, 0), MAX_RATE[phase]);
}

/** kcal per day for the phase: negative on a cut, positive on a bulk. 1 kg of body weight ≈ 7700 kcal. */
export function phaseAdjustment(phase: Phase, rate: number, weightKg: number): number {
  const sign = phase === 'cut' ? -1 : phase === 'bulk' ? 1 : 0;
  return (sign * (effectiveRate(phase, rate) / 100) * weightKg * KCAL_PER_KG) / 7;
}

/** Net workout energy: (MET − 1) × kg × hours, so the resting part isn't counted twice. Capped at 120 minutes. */
export function workoutEnergy(met: number, weightKg: number, minutes: number, sharePct: number): number {
  return Math.max(0, met - 1) * weightKg * (Math.min(Math.max(minutes, 0), MAX_WORKOUT_MINUTES) / 60) * (sharePct / 100);
}

export function proteinPerKg(s: Pick<TargetSettings, 'phase' | 'proteinGPerKg'>): number {
  return s.proteinGPerKg ?? (s.phase === 'cut' ? 2.0 : 1.8);
}

/**
 * The target for one day. `base` overrides the formula's maintenance (the adaptive estimate); `workout` makes it a
 * training day.
 */
export function dailyTarget(body: Body, s: TargetSettings, opts: { base?: { kcal: number; source: 'formula' | 'adaptive' } | null; workout?: Workout | null } = {}): Target {
  const steps: Step[] = [];
  const kg = body.weightKg;
  const b = Math.round(bmr(body));
  steps.push({
    id: 'bmr',
    kcal: b,
    text: loc(
      `Resting energy (BMR, Mifflin-St Jeor) for a ${body.sex === 'male' ? 'man' : 'woman'} of ${n(kg, 1).en} kg, ${n(body.heightCm).en} cm and ${body.age} years: ${kcalText(b).en} kcal.`,
      `Ruststofwisseling (BMR, Mifflin-St Jeor) voor een ${body.sex === 'male' ? 'man' : 'vrouw'} van ${n(kg, 1).nl} kg, ${n(body.heightCm).nl} cm en ${body.age} jaar: ${kcalText(b).nl} kcal.`,
    ),
  });

  const formulaBase = Math.round(bmr(body) * s.neat);
  const useAdaptive = opts.base?.source === 'adaptive';
  const base = Math.round(opts.base?.kcal ?? formulaBase);
  steps.push({
    id: 'base',
    kcal: formulaBase,
    text: loc(
      `Times ${n(s.neat, 2).en} for your activity outside training: ${kcalText(formulaBase).en} kcal. Training is not in this number; it is added on training days.`,
      `Keer ${n(s.neat, 2).nl} voor je activiteit buiten training: ${kcalText(formulaBase).nl} kcal. Training zit hier niet in; die komt erbij op trainingsdagen.`,
    ),
  });
  if (useAdaptive) {
    steps.push({
      id: 'adaptive',
      kcal: base,
      text: loc(
        `From what you ate and how your weight moved, your maintenance without training is about ${kcalText(base).en} kcal. That replaces the estimate above.`,
        `Uit wat je at en hoe je gewicht veranderde, is je onderhoud zonder training ongeveer ${kcalText(base).nl} kcal. Dat vervangt de schatting hierboven.`,
      ),
    });
  }

  const rate = effectiveRate(s.phase, s.ratePctPerWeek);
  const adjust = Math.round(phaseAdjustment(s.phase, s.ratePctPerWeek, kg));
  const capped = s.phase !== 'maintain' && s.ratePctPerWeek > MAX_RATE[s.phase];
  steps.push({
    id: 'phase',
    kcal: adjust,
    text:
      s.phase === 'maintain'
        ? loc('You are maintaining, so nothing is added or taken off.', 'Je houdt je gewicht vast, dus er gaat niets af of bij.')
        : loc(
            `${s.phase === 'cut' ? 'Losing' : 'Gaining'} ${n(rate, 2).en} % of your weight a week (${n((rate / 100) * kg, 2).en} kg) is ${n(Math.abs(adjust)).en} kcal a day ${s.phase === 'cut' ? 'less' : 'more'} (1 kg ≈ 7700 kcal).${capped ? ` That is the maximum for a ${s.phase}.` : ''}`,
            `${s.phase === 'cut' ? 'Afvallen' : 'Aankomen'} met ${n(rate, 2).nl} % van je gewicht per week (${n((rate / 100) * kg, 2).nl} kg) is ${n(Math.abs(adjust)).nl} kcal per dag ${s.phase === 'cut' ? 'minder' : 'meer'} (1 kg ≈ 7700 kcal).${capped ? ` Dat is het maximum bij ${s.phase === 'cut' ? 'afvallen' : 'aankomen'}.` : ''}`,
          ),
  });

  let rest = base + adjust;
  const floorHit = rest < b;
  if (floorHit) {
    rest = b;
    steps.push({
      id: 'floor',
      kcal: b,
      text: loc(
        `That would be below your resting energy, so the target stays at ${kcalText(b).en} kcal. Eating less than that for long isn't good for you or your training; a slower pace gets you there too.`,
        `Dat zou onder je ruststofwisseling komen, dus het doel blijft op ${kcalText(b).nl} kcal. Langere tijd minder eten is niet goed voor je of je training; rustiger aan brengt je er ook.`,
      ),
    });
  }

  const w = opts.workout ?? null;
  const workoutKcal = w ? Math.round(workoutEnergy(s.metStrength, kg, w.minutes, s.workoutEnergyShare)) : 0;
  if (w) {
    const minutes = Math.min(w.minutes, MAX_WORKOUT_MINUTES);
    const what =
      w.source === 'planned'
        ? loc(`your planned training of ${minutes} minutes`, `je geplande training van ${minutes} minuten`)
        : w.source === 'in_progress'
          ? loc(`the workout in progress (${minutes} minutes so far)`, `de training die loopt (tot nu toe ${minutes} minuten)`)
          : loc(`your workout of ${minutes} minutes`, `je training van ${minutes} minuten`);
    steps.push({
      id: 'workout',
      kcal: workoutKcal,
      text: loc(
        `Training day: ${what.en} at MET ${n(s.metStrength, 1).en} adds (${n(s.metStrength, 1).en} − 1) × ${n(kg, 1).en} kg × ${n(minutes / 60, 2).en} h${s.workoutEnergyShare !== 100 ? `, of which ${s.workoutEnergyShare} % counts,` : ''} = ${kcalText(workoutKcal).en} kcal.`,
        `Trainingsdag: ${what.nl} met MET ${n(s.metStrength, 1).nl} voegt (${n(s.metStrength, 1).nl} − 1) × ${n(kg, 1).nl} kg × ${n(minutes / 60, 2).nl} u toe${s.workoutEnergyShare !== 100 ? `, waarvan ${s.workoutEnergyShare} % meetelt,` : ''} = ${kcalText(workoutKcal).nl} kcal.`,
      ),
    });
  }

  // Macros on the rest-day target; training-day energy goes on top.
  const ppk = proteinPerKg(s);
  const proteinG = Math.round(ppk * kg);
  const fatRest = Math.round((FAT_MIN_SHARE * rest) / 9);
  const carbsRest = Math.max(0, Math.round((rest - proteinG * 4 - fatRest * 9) / 4));
  let carbsG = carbsRest;
  let fatG = fatRest;
  if (workoutKcal > 0) {
    if (s.carbCycling) carbsG += Math.round(workoutKcal / 4);
    else {
      fatG += Math.round((workoutKcal * FAT_MIN_SHARE) / 9);
      carbsG += Math.round((workoutKcal * (1 - FAT_MIN_SHARE)) / 4);
    }
  }
  steps.push({
    id: 'protein',
    kcal: proteinG * 4,
    text: loc(
      `Protein: ${n(ppk, 1).en} g per kg${s.proteinGPerKg === null ? (s.phase === 'cut' ? ' (more on a cut, to keep muscle)' : '') : ' (your setting)'} = ${proteinG} g.`,
      `Eiwit: ${n(ppk, 1).nl} g per kg${s.proteinGPerKg === null ? (s.phase === 'cut' ? ' (meer bij afvallen, om spier te behouden)' : '') : ' (jouw instelling)'} = ${proteinG} g.`,
    ),
  });
  steps.push({
    id: 'fat',
    kcal: fatG * 9,
    text: loc(`Fat: at least 25 % of the energy = ${fatG} g.`, `Vet: minstens 25 % van de energie = ${fatG} g.`),
  });
  steps.push({
    id: 'carbs',
    kcal: carbsG * 4,
    text:
      workoutKcal > 0 && s.carbCycling
        ? loc(`Carbohydrates: the rest, plus the training energy = ${carbsG} g.`, `Koolhydraten: de rest, plus de trainingsenergie = ${carbsG} g.`)
        : loc(`Carbohydrates: the rest = ${carbsG} g.`, `Koolhydraten: de rest = ${carbsG} g.`),
  });

  return {
    kcal: rest + workoutKcal,
    proteinG,
    carbsG,
    fatG,
    bmr: b,
    base,
    baseSource: useAdaptive ? 'adaptive' : 'formula',
    phaseAdjust: adjust,
    restKcal: rest,
    workoutKcal,
    isTrainingDay: Boolean(w),
    floorHit,
    steps,
  };
}

// ---------- Adaptive TDEE ----------

export interface DayIntake {
  date: string;
  /** null: nothing logged. */
  kcal: number | null;
  incomplete: boolean;
  /** Workout energy credited that day (0 on rest days). */
  workoutKcal: number;
}

export interface WeighIn {
  date: string;
  kg: number;
}

export interface AdaptiveResult {
  status: 'ok' | 'not_enough';
  /** The maintenance (without training) to use: the formula until there is enough data. */
  base: number;
  formulaBase: number;
  /** From intake and weight change, before blending and clamping. */
  adaptiveBase: number | null;
  loggedDays: number;
  weighIns: number;
  spanDays: number;
  trendChangeKg: number | null;
  /** How much the adaptive estimate counts (0..1); grows with logged days. */
  weight: number;
  clamped: boolean;
  text: Localized;
}

export const ADAPTIVE_MIN = { spanDays: 14, loggedDays: 10, weighIns: 8 };

/** Exponentially weighted moving average, one step per weigh-in: smooths out water and food in the gut. */
export function ewma(values: number[], alpha = EWMA_ALPHA): number[] {
  const out: number[] = [];
  for (const v of values) out.push(out.length ? out[out.length - 1] + alpha * (v - out[out.length - 1]) : v);
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Maintenance from your own data: average intake minus the energy in the change of your trend weight. Needs at
 * least 14 days, 10 complete logged days and 8 weigh-ins. Training energy credited on those days is taken off, so
 * the result is maintenance without training, like the formula. It is blended with the formula as data grows and
 * moves at most ±150 kcal a week from the previous week's value.
 */
export function adaptiveTdee(input: { days: DayIntake[]; weights: WeighIn[]; formulaBase: number; previous: { base: number; weeksAgo: number } | null }): AdaptiveResult {
  const { days, formulaBase } = input;
  const weights = [...input.weights].sort((a, b) => a.date.localeCompare(b.date));
  const logged = days.filter((d) => d.kcal !== null && d.kcal > 0 && !d.incomplete);
  // Calendar days covered by the weigh-ins (both ends included); the weight change is spread over the days in between.
  const elapsed = weights.length > 1 ? daysBetween(weights[0].date, weights[weights.length - 1].date) : 0;
  const spanDays = weights.length > 1 ? elapsed + 1 : 0;
  const base = { formulaBase, loggedDays: logged.length, weighIns: weights.length, spanDays };

  if (spanDays < ADAPTIVE_MIN.spanDays || logged.length < ADAPTIVE_MIN.loggedDays || weights.length < ADAPTIVE_MIN.weighIns) {
    return {
      ...base,
      status: 'not_enough',
      base: formulaBase,
      adaptiveBase: null,
      trendChangeKg: null,
      weight: 0,
      clamped: false,
      text: loc(
        `Your own maintenance is worked out once there are 14 days with at least 10 complete days logged and 8 weigh-ins (now ${logged.length} days and ${weights.length} weigh-ins over ${spanDays} days). Until then the formula is used.`,
        `Je eigen onderhoud wordt berekend zodra er 14 dagen zijn met minstens 10 complete gelogde dagen en 8 wegingen (nu ${logged.length} dagen en ${weights.length} wegingen over ${spanDays} dagen). Tot die tijd geldt de formule.`,
      ),
    };
  }

  const trend = ewma(weights.map((w) => w.kg));
  const change = trend[trend.length - 1] - trend[0];
  const avgIntake = logged.reduce((a, d) => a + d.kcal!, 0) / logged.length;
  const avgWorkout = logged.reduce((a, d) => a + d.workoutKcal, 0) / logged.length;
  const adaptiveBase = avgIntake - (change * KCAL_PER_KG) / elapsed - avgWorkout;
  const weight = Math.min(1, logged.length / 28);
  let result = formulaBase + weight * (adaptiveBase - formulaBase);
  let clamped = false;
  if (input.previous) {
    const step = MAX_TDEE_STEP * Math.max(1, input.previous.weeksAgo);
    const lo = input.previous.base - step;
    const hi = input.previous.base + step;
    if (result < lo || result > hi) {
      result = Math.min(hi, Math.max(lo, result));
      clamped = true;
    }
  }
  const r = Math.round(result);
  return {
    ...base,
    status: 'ok',
    base: r,
    adaptiveBase: Math.round(adaptiveBase),
    trendChangeKg: Math.round(change * 100) / 100,
    weight,
    clamped,
    text: loc(
      `Over ${spanDays} days you ate on average ${kcalText(avgIntake).en} kcal and your trend weight changed ${change >= 0 ? '+' : '−'}${n(Math.abs(change), 2).en} kg. That points to ${kcalText(adaptiveBase).en} kcal maintenance without training; it counts for ${Math.round(weight * 100)} %, the formula for the rest${clamped ? ', and it moves at most 150 kcal a week' : ''}: ${kcalText(r).en} kcal.`,
      `Over ${spanDays} dagen at je gemiddeld ${kcalText(avgIntake).nl} kcal en veranderde je trendgewicht ${change >= 0 ? '+' : '−'}${n(Math.abs(change), 2).nl} kg. Dat wijst op ${kcalText(adaptiveBase).nl} kcal onderhoud zonder training; dat telt voor ${Math.round(weight * 100)} % mee, de formule voor de rest${clamped ? ', en het verschuift hooguit 150 kcal per week' : ''}: ${kcalText(r).nl} kcal.`,
    ),
  };
}
