// The week looked back on: intake against target, protein, training, the weight trend and what gave the most energy.
// Only adds up what the target engine and the diary already have; it never works out a target itself.
import type { WeekReport } from '../../shared/types.ts';
import { all } from '../db.ts';
import { pick, type Lang } from '../i18n.ts';
import { daySummaries, weekStart } from './dayTargets.ts';
import { addDays, today } from './days.ts';
import { getProfile, timeZoneOf } from './profile.ts';
import { ewma } from './targets.ts';

/** Share of the protein target that counts as reached. */
export const PROTEIN_HIT = 0.95;

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** The week that holds `day`; without a day, last week (the last complete one). A week still to come gives this week. */
export async function weekReport(day: string | undefined, lang: Lang): Promise<WeekReport> {
  const now = today(timeZoneOf(await getProfile()));
  const thisWeek = weekStart(now);
  let start = day ? weekStart(day) : weekStart(addDays(now, -7));
  if (start > thisWeek) start = thisWeek;
  const end = addDays(start, 6);
  const { days: all7, weights } = await daySummaries(start, end);
  const sofar = all7.filter((d) => d.date <= now);
  const complete = sofar.filter((d) => d.logged && !d.incomplete);
  const withTarget = complete.filter((d) => d.targetKcal !== null);
  const withProtein = complete.filter((d) => d.targetProteinG !== null);

  const trend = ewma(weights.map((w) => w.kg));
  const trendOn = (d: string) => {
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i].date <= d) return Math.round(trend[i] * 100) / 100;
    return null;
  };
  const lastDay = end < now ? end : now;
  // The trend just before the week; with no weigh-in before it, the first one in it.
  const firstInWeek = weights.find((w) => w.date >= start && w.date <= lastDay);
  const startKg = trendOn(addDays(start, -1)) ?? (firstInWeek ? trendOn(firstInWeek.date) : null);
  const endKg = trendOn(lastDay);

  const topFoods = await all<{ name: string; kcal: number; times: number }>(
    `SELECT name, sum(kcal)::float AS kcal, count(*)::int AS times FROM diary_entries
     WHERE day BETWEEN $1 AND $2 GROUP BY name ORDER BY sum(kcal) DESC, name LIMIT 5`,
    [start, lastDay],
  );

  return {
    weekStart: start,
    weekEnd: end,
    previous: addDays(start, -7),
    next: start < thisWeek ? addDays(start, 7) : null,
    days: all7.map((d) => ({
      date: d.date,
      kcal: d.kcal,
      proteinG: d.proteinG,
      carbsG: d.carbsG,
      fatG: d.fatG,
      logged: d.logged,
      incomplete: d.incomplete,
      targetKcal: d.targetKcal,
      isTrainingDay: d.isTrainingDay,
    })),
    loggedDays: sofar.filter((d) => d.logged).length,
    completeDays: complete.length,
    daysSoFar: sofar.length,
    avgKcal: avg(complete.map((d) => d.kcal)),
    avgTargetKcal: avg(withTarget.map((d) => d.targetKcal!)),
    balanceKcal: withTarget.length ? withTarget.reduce((sum, d) => sum + d.kcal - d.targetKcal!, 0) : null,
    avgProteinG: avg(complete.map((d) => d.proteinG)),
    avgCarbsG: avg(complete.map((d) => d.carbsG)),
    avgFatG: avg(complete.map((d) => d.fatG)),
    proteinHitDays: withProtein.filter((d) => d.proteinG >= d.targetProteinG! * PROTEIN_HIT).length,
    proteinTargetDays: withProtein.length,
    trainingDays: sofar.filter((d) => d.isTrainingDay).length,
    trendStartKg: startKg,
    trendEndKg: endKg,
    trendChangeKg: startKg !== null && endKg !== null ? Math.round((endKg - startKg) * 100) / 100 : null,
    weighIns: weights.filter((w) => w.date >= start && w.date <= lastDay).length,
    topFoods: topFoods.map((f) => ({ name: pick(f.name, lang), kcal: Math.round(f.kcal), times: f.times })),
  };
}
