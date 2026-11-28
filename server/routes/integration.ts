import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all } from '../db.ts';
import { langOf, pick } from '../i18n.ts';
import { applyBodyWeight, syncProfile } from '../services/bodyWeight.ts';
import { currentMaintenance, daySummaries, missingFields, setWorkoutSource } from '../services/dayTargets.ts';
import { addDays, DAY_PATTERN, daysBetween, today } from '../services/days.ts';
import { getProfile, timeZoneOf } from '../services/profile.ts';
import {
  goalClash,
  importStrengthWeightsOnce,
  linked,
  linkStatus,
  outboxSize,
  strengthProfile,
  strengthWorkouts,
  workoutsByDay,
} from '../services/strength.ts';
import { proteinPerKg } from '../services/targets.ts';

const range = z
  .object({ from: z.string().regex(DAY_PATTERN), to: z.string().regex(DAY_PATTERN) })
  .refine((r) => r.from <= r.to && daysBetween(r.from, r.to) <= 366, 'at most a year, from before to');

// Workouts from Open Strength make training days (when linked; otherwise no workouts, never an error).
setWorkoutSource(async (from, to) => (linked() ? workoutsByDay(from, to) : new Map()));

/**
 * The versioned API for Open Strength (/api/integration/v1/*): a bearer token only, checked in authHook (404 when no
 * token is configured). Plus /api/linked/strength, which the PWA calls after the page has rendered.
 */
export async function integrationRoutes(app: FastifyInstance) {
  // Intake and target per day, in this app's time zone.
  app.get('/api/integration/v1/days', async (req) => {
    const { from, to } = range.parse(req.query);
    const { days } = await daySummaries(from, to);
    return days.map((d) => ({
      date: d.date,
      kcal: d.kcal,
      proteinG: d.proteinG,
      carbsG: d.carbsG,
      fatG: d.fatG,
      targetKcal: d.targetKcal,
      targetProteinG: d.targetProteinG,
      isTrainingDay: d.isTrainingDay,
      complete: d.logged && !d.incomplete,
    }));
  });

  // The nutrition phase and the last 14 complete days (today left out: it isn't finished). null without a profile.
  app.get('/api/integration/v1/phase', async () => {
    const p = await getProfile();
    const weights = await all('SELECT 1 FROM body_weights LIMIT 1');
    if (!p || missingFields(p, weights.length > 0).length) return null;
    const now = today(timeZoneOf(p));
    const maintenance = await currentMaintenance(p, now);
    const { days } = await daySummaries(addDays(now, -14), addDays(now, -1));
    const complete = days.filter((d) => d.logged && !d.incomplete && d.maintenanceKcal !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const balance = avg(complete.map((d) => d.kcal - d.maintenanceKcal!));
    const protein = avg(complete.filter((d) => d.weightKg).map((d) => d.proteinG / d.weightKg!));
    return {
      phase: p.phase,
      ratePctPerWeek: p.phase === 'maintain' ? 0 : p.ratePctPerWeek,
      estimatedTdee: maintenance.base,
      proteinGPerKg: proteinPerKg(p),
      avgProteinGPerKg14d: protein === null ? null : Math.round(protein * 100) / 100,
      avgEnergyBalance14d: balance === null ? null : Math.round(balance),
      loggedDays14d: complete.length,
    };
  });

  app.get('/api/integration/v1/body-weights', async (req) => {
    const { from, to } = range.parse(req.query);
    return all('SELECT measured_on AS "date", weight_kg AS "weightKg" FROM body_weights WHERE measured_on BETWEEN $1 AND $2 ORDER BY measured_on', [from, to]);
  });

  app.put('/api/integration/v1/body-weights/:date', async (req) => {
    const { date } = z.object({ date: z.string().regex(DAY_PATTERN) }).parse(req.params);
    const { weightKg } = z.object({ weightKg: z.number().min(30).max(300) }).parse(req.body);
    await applyBodyWeight(date, weightKg);
    return { ok: true };
  });

  app.delete('/api/integration/v1/body-weights/:date', async (req) => {
    const { date } = z.object({ date: z.string().regex(DAY_PATTERN) }).parse(req.params);
    await applyBodyWeight(date, null);
    return { ok: true };
  });

  // For the PWA: the link's status, today's workouts, Open Strength's profile and goal. Loaded after the page.
  app.get('/api/linked/strength', async () => {
    const p = await getProfile();
    const lang = langOf(p);
    const status = await linkStatus();
    const now = today(timeZoneOf(p));
    if (status === 'ok' && (await importStrengthWeightsOnce(now)) > 0) await syncProfile();
    const profile = status === 'ok' ? await strengthProfile() : null;
    const workouts = status === 'ok' ? await strengthWorkouts(now, now) : [];
    const clash = p && profile ? goalClash(profile.goal, p.phase, p.ratePctPerWeek) : null;
    return {
      status,
      profile,
      todayWorkouts: workouts,
      clash: clash ? pick(clash, lang) : null,
      pendingWeights: status === 'off' ? 0 : await outboxSize(),
    };
  });
}
