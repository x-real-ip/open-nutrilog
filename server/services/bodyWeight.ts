// Body weight over time, one entry per day. The latest entry is the profile's weight, so targets always use your
// current weight; editing the weight in the profile also logs it for today.
import { z } from 'zod';
import type { BodyWeightEntry, Profile } from '../../shared/types.ts';
import { all, getPool, nowIso, one, run, type Queryable } from '../db.ts';
import { DAY_PATTERN, today } from './days.ts';
import { getProfile, saveProfile, timeZoneOf } from './profile.ts';

export const weighInSchema = z
  .object({ weightKg: z.number().min(30).max(300), date: z.string().regex(DAY_PATTERN).optional() })
  .strict();

export async function listBodyWeights(db: Queryable = getPool()): Promise<BodyWeightEntry[]> {
  return all<BodyWeightEntry>('SELECT id, measured_on AS "date", weight_kg AS "weightKg" FROM body_weights ORDER BY measured_on', [], db);
}

/** Record a weight for a day (replacing that day's entry) without touching the profile. */
export async function recordBodyWeight(weightKg: number, date: string, db: Queryable = getPool()): Promise<void> {
  await run(
    `INSERT INTO body_weights (measured_on, weight_kg, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (measured_on) DO UPDATE SET weight_kg = excluded.weight_kg, created_at = excluded.created_at`,
    [date, Math.round(weightKg * 10) / 10, nowIso()],
    db,
  );
}

/** The profile follows the most recent entry. */
async function syncProfile(): Promise<void> {
  const latest = await one<{ weight_kg: number }>('SELECT weight_kg FROM body_weights ORDER BY measured_on DESC LIMIT 1');
  const profile = await getProfile();
  if (latest && profile && profile.weightKg !== latest.weight_kg) await saveProfile({ ...profile, weightKg: latest.weight_kg });
}

export async function logBodyWeight(raw: unknown): Promise<BodyWeightEntry[]> {
  const { weightKg, date } = weighInSchema.parse(raw);
  await recordBodyWeight(weightKg, date ?? today(timeZoneOf(await getProfile())));
  await syncProfile();
  return listBodyWeights();
}

export async function deleteBodyWeight(id: number): Promise<BodyWeightEntry[]> {
  await run('DELETE FROM body_weights WHERE id = $1', [id]);
  await syncProfile();
  return listBodyWeights();
}

/** Editing the weight in the profile also counts as today's weigh-in. */
export async function noteProfileWeight(before: Profile | null, after: Profile): Promise<void> {
  if (after.weightKg !== null && (!before || before.weightKg !== after.weightKg)) {
    await recordBodyWeight(after.weightKg, today(timeZoneOf(after)));
  }
}
