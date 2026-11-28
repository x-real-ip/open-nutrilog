// Connects the target engine (targets.ts, pure) to your data: profile, weigh-ins, day marks, the diary and the
// weekly maintenance estimate. Nothing here decides a number on its own; it only gathers the inputs.
import { z } from 'zod';
import type { AdaptiveView, DayMark, DayTarget, Profile, ProgressResponse, TargetResponse } from '../../shared/types.ts';
import { all, getPool, one, run, type Queryable } from '../db.ts';
import { langOf, pick, type Lang } from '../i18n.ts';
import { addDays, DAY_PATTERN, daysBetween, today } from './days.ts';
import { getProfile, timeZoneOf } from './profile.ts';
import { adaptiveTdee, bmr, dailyTarget, ewma, workoutEnergy, type AdaptiveResult, type Body, type Target, type TargetSettings, type Workout } from './targets.ts';

/** Monday of the week a day is in. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

export function settingsOf(p: Profile): TargetSettings {
  return {
    neat: p.neat,
    phase: p.phase,
    ratePctPerWeek: p.ratePctPerWeek,
    proteinGPerKg: p.proteinGPerKg,
    carbCycling: p.carbCycling,
    metStrength: p.metStrength,
    workoutEnergyShare: p.workoutEnergyShare,
  };
}

/** Profile fields a target still needs. A weigh-in counts as a weight. */
export function missingFields(p: Profile | null, hasWeighIn = false): TargetResponse['missing'] {
  const out: TargetResponse['missing'] = [];
  if (!p?.sex) out.push('sex');
  if (!p?.age) out.push('age');
  if (!p?.heightCm) out.push('heightCm');
  if (!p?.weightKg && !hasWeighIn) out.push('weightKg');
  return out;
}

function bodyOf(p: Profile, weightKg: number): Body {
  return { sex: p.sex!, age: p.age!, heightCm: p.heightCm!, weightKg };
}

// ---------- Day marks ----------

export const markSchema = z.object({ training: z.boolean().nullable().optional(), incomplete: z.boolean().optional() }).strict();

export async function getMarks(from: string, to: string, db: Queryable = getPool()): Promise<Map<string, DayMark>> {
  const rows = await all<{ day: string; training: boolean | null; incomplete: boolean }>('SELECT day, training, incomplete FROM day_marks WHERE day BETWEEN $1 AND $2', [from, to], db);
  return new Map(rows.map((r) => [r.day, { training: r.training, incomplete: r.incomplete }]));
}

export async function setMark(day: string, raw: unknown): Promise<DayMark> {
  z.string().regex(DAY_PATTERN).parse(day);
  const input = markSchema.parse(raw);
  const current = (await getMarks(day, day)).get(day) ?? { training: null, incomplete: false };
  const next: DayMark = { training: input.training === undefined ? current.training : input.training, incomplete: input.incomplete ?? current.incomplete };
  if (next.training === null && !next.incomplete) await run('DELETE FROM day_marks WHERE day = $1', [day]);
  else
    await run(
      `INSERT INTO day_marks (day, training, incomplete, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (day) DO UPDATE SET training = excluded.training, incomplete = excluded.incomplete, updated_at = now()`,
      [day, next.training, next.incomplete],
    );
  return next;
}

// ---------- Workouts ----------

/**
 * Workouts per day. A day you marked as "training today" counts with your usual training length; a day marked "not
 * a training day" never counts. (The link with Open Strength adds its real workouts here.)
 */
export type WorkoutSource = (from: string, to: string) => Promise<Map<string, Workout>>;

let linkedWorkouts: WorkoutSource = async () => new Map();

/** Used by the Open Strength link; tests can swap it too. */
export function setWorkoutSource(source: WorkoutSource) {
  linkedWorkouts = source;
}

async function workoutsBetween(p: Profile, from: string, to: string, marks: Map<string, DayMark>): Promise<Map<string, Workout>> {
  const linked = await linkedWorkouts(from, to).catch(() => new Map<string, Workout>());
  const out = new Map<string, Workout>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const mark = marks.get(d);
    if (mark?.training === false) continue;
    const w = linked.get(d);
    if (w) out.set(d, w);
    else if (mark?.training === true) out.set(d, { minutes: p.trainingMinutes, source: 'planned' });
  }
  return out;
}

// ---------- Weights ----------

async function weighIns(db: Queryable = getPool()): Promise<{ date: string; kg: number }[]> {
  return all('SELECT measured_on AS date, weight_kg AS kg FROM body_weights ORDER BY measured_on', [], db);
}

/** The weight on a day: the last weigh-in on or before it, else the first one after it, else the profile's. */
function weightOn(day: string, weights: { date: string; kg: number }[], fallback: number | null): number | null {
  let found: number | null = null;
  for (const w of weights) {
    if (w.date <= day) found = w.kg;
    else break;
  }
  return found ?? weights[0]?.kg ?? fallback;
}

// ---------- Maintenance ----------

async function intakeByDay(from: string, to: string): Promise<Map<string, { kcal: number; protein: number; carbs: number; fat: number; n: number }>> {
  const rows = await all<{ day: string; kcal: number; protein: number; carbs: number; fat: number; n: number }>(
    `SELECT day, sum(kcal) AS kcal, coalesce(sum(protein), 0) AS protein, coalesce(sum(carbs), 0) AS carbs, coalesce(sum(fat), 0) AS fat, count(*)::int AS n
     FROM diary_entries WHERE day BETWEEN $1 AND $2 GROUP BY day`,
    [from, to],
  );
  return new Map(rows.map((r) => [r.day, r]));
}

/**
 * This week's maintenance without training: the formula, or the adaptive estimate from the last 28 days (today
 * left out: it isn't finished). Stored once per week so it moves at most 150 kcal from the week before.
 */
export async function currentMaintenance(p: Profile, todayDay: string, weights?: { date: string; kg: number }[]): Promise<AdaptiveResult> {
  const ws = weights ?? (await weighIns());
  const kg = weightOn(todayDay, ws, p.weightKg)!;
  const formulaBase = Math.round(bmr(bodyOf(p, kg)) * p.neat);
  const from = addDays(todayDay, -28);
  const to = addDays(todayDay, -1);
  const marks = await getMarks(from, to);
  const workouts = await workoutsBetween(p, from, to, marks);
  const intake = await intakeByDay(from, to);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = workouts.get(d);
    days.push({
      date: d,
      kcal: intake.get(d)?.kcal ?? null,
      incomplete: marks.get(d)?.incomplete ?? false,
      workoutKcal: w ? workoutEnergy(p.metStrength, weightOn(d, ws, kg)!, w.minutes, p.workoutEnergyShare) : 0,
    });
  }
  const week = weekStart(todayDay);
  const prev = await one<{ week_start: string; base_kcal: number }>(
    'SELECT week_start, base_kcal FROM tdee_history WHERE week_start < $1 AND adaptive_kcal IS NOT NULL ORDER BY week_start DESC LIMIT 1',
    [week],
  );
  const result = adaptiveTdee({
    days,
    weights: ws.filter((w) => w.date >= from && w.date <= to),
    formulaBase,
    previous: prev ? { base: prev.base_kcal, weeksAgo: Math.max(1, Math.round(daysBetween(prev.week_start, week) / 7)) } : null,
  });
  await run(
    `INSERT INTO tdee_history (week_start, base_kcal, formula_kcal, adaptive_kcal, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (week_start) DO UPDATE SET base_kcal = excluded.base_kcal, formula_kcal = excluded.formula_kcal,
       adaptive_kcal = excluded.adaptive_kcal, updated_at = now()`,
    [week, result.base, result.formulaBase, result.status === 'ok' ? result.base : null],
  );
  return result;
}

function adaptiveView(r: AdaptiveResult, lang: Lang): AdaptiveView {
  return { status: r.status, base: r.base, formulaBase: r.formulaBase, loggedDays: r.loggedDays, weighIns: r.weighIns, spanDays: r.spanDays, text: pick(r.text, lang) };
}

function targetView(t: Target, workout: Workout | null, lang: Lang): DayTarget {
  const { steps, ...rest } = t;
  return { ...rest, workout, steps: steps.map((s) => ({ id: s.id, kcal: s.kcal, text: pick(s.text, lang) })) };
}

// ---------- Targets ----------

/** The target for one day, with how it was built. Without sex, age, height and weight there is no target yet. */
export async function targetFor(day: string): Promise<TargetResponse> {
  z.string().regex(DAY_PATTERN).parse(day);
  const p = await getProfile();
  const lang = langOf(p);
  const mark = (await getMarks(day, day)).get(day) ?? { training: null, incomplete: false };
  const ws = await weighIns();
  const missing = missingFields(p, ws.length > 0);
  if (!p || missing.length) return { day, target: null, missing, mark, adaptive: null };

  const kg = weightOn(day, ws, p.weightKg)!;
  const now = today(timeZoneOf(p));
  const maintenance = await currentMaintenance(p, now, ws);
  // Days before this week use the maintenance stored for their week.
  let base = maintenance.status === 'ok' ? { kcal: maintenance.base, source: 'adaptive' as const } : null;
  if (weekStart(day) < weekStart(now)) {
    const row = await one<{ base_kcal: number; adaptive_kcal: number | null }>('SELECT base_kcal, adaptive_kcal FROM tdee_history WHERE week_start = $1', [weekStart(day)]);
    base = row?.adaptive_kcal != null ? { kcal: row.base_kcal, source: 'adaptive' } : null;
  }
  const workout = (await workoutsBetween(p, day, day, new Map([[day, mark]]))).get(day) ?? null;
  const target = dailyTarget(bodyOf(p, kg), settingsOf(p), { base, workout });
  return { day, target: targetView(target, workout, lang), missing, mark, adaptive: adaptiveView(maintenance, lang) };
}

// ---------- Days and progress ----------

/** One day: what was eaten and what the target was (null without a complete profile). */
export interface DaySummary {
  date: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  logged: boolean;
  incomplete: boolean;
  targetKcal: number | null;
  targetProteinG: number | null;
  /** Maintenance with that day's training: what eating "at maintenance" would have been. */
  maintenanceKcal: number | null;
  weightKg: number | null;
  isTrainingDay: boolean;
}

interface History {
  week_start: string;
  base_kcal: number;
  formula_kcal: number;
  adaptive_kcal: number | null;
}

/** Days from `from` to `to` with intake and target. Also returns the weekly maintenance history (this week fresh). */
export async function daySummaries(from: string, to: string): Promise<{ days: DaySummary[]; history: History[]; weights: { date: string; kg: number }[]; now: string }> {
  const p = await getProfile();
  const now = today(timeZoneOf(p));
  const ws = await weighIns();
  const intake = await intakeByDay(from, to);
  const marks = await getMarks(from, to);
  const canTarget = p !== null && missingFields(p, ws.length > 0).length === 0;
  const workouts = p ? await workoutsBetween(p, from, to, marks) : new Map<string, Workout>();
  const history = await all<History>('SELECT week_start, base_kcal, formula_kcal, adaptive_kcal FROM tdee_history ORDER BY week_start');
  if (canTarget) {
    const current = await currentMaintenance(p!, now, ws);
    const week = weekStart(now);
    const row = history.find((h) => h.week_start === week);
    const fresh = { week_start: week, base_kcal: current.base, formula_kcal: current.formulaBase, adaptive_kcal: current.status === 'ok' ? current.base : null };
    if (row) Object.assign(row, fresh);
    else history.push(fresh);
  }
  const byWeek = new Map(history.map((h) => [h.week_start, h]));

  const days: DaySummary[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const i = intake.get(d);
    const mark = marks.get(d);
    const w = workouts.get(d) ?? null;
    const kg = p ? weightOn(d, ws, p.weightKg) : null;
    let target: Target | null = null;
    if (canTarget && kg) {
      const h = byWeek.get(weekStart(d)) ?? byWeek.get(weekStart(now));
      const base = h?.adaptive_kcal != null ? { kcal: h.base_kcal, source: 'adaptive' as const } : null;
      target = dailyTarget(bodyOf(p!, kg), settingsOf(p!), { base, workout: w });
    }
    days.push({
      date: d,
      kcal: Math.round(i?.kcal ?? 0),
      proteinG: Math.round(i?.protein ?? 0),
      carbsG: Math.round(i?.carbs ?? 0),
      fatG: Math.round(i?.fat ?? 0),
      logged: Boolean(i?.n),
      incomplete: mark?.incomplete ?? false,
      targetKcal: target?.kcal ?? null,
      targetProteinG: target?.proteinG ?? null,
      maintenanceKcal: target ? target.base + target.workoutKcal : null,
      weightKg: kg,
      isTrainingDay: Boolean(w),
    });
  }
  return { days, history, weights: ws, now };
}

/** Intake against target per day and week, weight with its trend, the maintenance per week. */
export async function progress(numDays: number): Promise<ProgressResponse> {
  const p = await getProfile();
  const end = today(timeZoneOf(p));
  const from = addDays(end, -(numDays - 1));
  const { days: summaries, history, weights: ws, now } = await daySummaries(from, end);
  const days: ProgressResponse['days'] = summaries.map((d) => ({
    date: d.date,
    kcal: d.kcal,
    proteinG: d.proteinG,
    carbsG: d.carbsG,
    fatG: d.fatG,
    logged: d.logged,
    incomplete: d.incomplete,
    targetKcal: d.targetKcal,
    isTrainingDay: d.isTrainingDay,
  }));

  const trend = ewma(ws.map((w) => w.kg));
  const weights = ws.map((w, i) => ({ date: w.date, weightKg: w.kg, trendKg: Math.round(trend[i] * 100) / 100 }));
  const trendOn = (day: string) => [...weights].reverse().find((w) => w.date <= day)?.trendKg ?? null;
  const nowTrend = trendOn(now);
  const weekAgo = trendOn(addDays(now, -7));
  const weeklyChangeKg = nowTrend !== null && weekAgo !== null && weights[0].date <= addDays(now, -7) ? Math.round((nowTrend - weekAgo) * 100) / 100 : null;

  // Weeks (Monday to Sunday) with their average intake and target over the complete logged days.
  const weekMap = new Map<string, { kcal: number[]; target: number[] }>();
  for (const d of days) {
    const key = weekStart(d.date);
    const w = weekMap.get(key) ?? { kcal: [], target: [] };
    if (d.logged && !d.incomplete) {
      w.kcal.push(d.kcal);
      if (d.targetKcal !== null) w.target.push(d.targetKcal);
    }
    weekMap.set(key, w);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const weeks = [...weekMap.entries()].map(([weekStartDay, w]) => ({ weekStart: weekStartDay, avgKcal: avg(w.kcal), avgTargetKcal: avg(w.target), loggedDays: w.kcal.length }));

  // Averages over the last 7 complete logged days before today.
  const recent = days.filter((d) => d.date < now && d.logged && !d.incomplete).slice(-7);
  const averages = recent.length
    ? {
        days: recent.length,
        kcal: avg(recent.map((d) => d.kcal))!,
        proteinG: avg(recent.map((d) => d.proteinG))!,
        carbsG: avg(recent.map((d) => d.carbsG))!,
        fatG: avg(recent.map((d) => d.fatG))!,
      }
    : null;

  return {
    days,
    weights,
    weeklyChangeKg,
    weeks,
    averages,
    tdee: history.map((h) => ({ weekStart: h.week_start, baseKcal: h.base_kcal, formulaKcal: h.formula_kcal, adaptiveKcal: h.adaptive_kcal })),
  };
}
