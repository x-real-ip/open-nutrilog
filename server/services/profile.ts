import { z } from 'zod';
import type { Profile } from '../../shared/types.ts';
import { config, validTimeZone } from '../config.ts';
import { nowIso, one, run } from '../db.ts';
import { DEFAULT_MET, DEFAULT_NEAT, MAX_SHIFT_KCAL } from './targets.ts';

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const fields = z.object({
  name: z.string().trim().max(60).default(''),
  language: z.enum(['en', 'nl']).default('en'),
  timeZone: z
    .string()
    .trim()
    .max(64)
    .default('')
    .refine((tz) => tz === '' || validTimeZone(tz) !== undefined, 'unknown time zone'),
  sex: z.enum(['male', 'female']).nullable().default(null),
  age: z.number().int().min(12).max(100).nullable().default(null),
  heightCm: z.number().min(100).max(250).nullable().default(null),
  weightKg: z.number().min(30).max(300).nullable().default(null),
  neat: z.number().min(1.1).max(2).default(DEFAULT_NEAT),
  phase: z.enum(['cut', 'maintain', 'bulk']).default('maintain'),
  ratePctPerWeek: z.number().min(0).max(1).default(0.5),
  proteinGPerKg: z.number().min(0.8).max(3).nullable().default(null),
  carbCycling: z.boolean().default(true),
  metStrength: z.number().min(2).max(10).default(DEFAULT_MET),
  trainingMinutes: z.number().int().min(10).max(180).default(60),
  workoutEnergyShare: z.union([z.literal(0), z.literal(50), z.literal(100)]).default(100),
  /** Push reminders at a time of day (HH:MM in the profile's time zone); null is off. */
  reminders: z
    .object({
      meals: z.array(z.object({ mealId: z.number().int().positive(), time: clockTime })).max(10).default([]),
      weighIn: clockTime.nullable().default(null),
      summary: clockTime.nullable().default(null),
    })
    .default({ meals: [], weighIn: null, summary: null }),
  fasting: z.boolean().default(false),
  fastingGoalHours: z.number().int().min(1).max(72).default(16),
  /** Higher days (1 = Monday … 7 = Sunday) with their extra energy; the other days give it back. */
  shiftDays: z
    .array(z.number().int().min(1).max(7))
    .max(6)
    .default([])
    .refine((d) => new Set(d).size === d.length, 'each day once'),
  shiftKcal: z.number().int().min(0).max(MAX_SHIFT_KCAL).default(0),
  /** The day's target per meal, in % (adding up to 100), or none. */
  mealShares: z
    .array(z.object({ mealId: z.number().int().positive(), pct: z.number().int().min(0).max(100) }))
    .max(10)
    .default([])
    .refine((m) => m.every((x) => x.pct === 0) || m.reduce((sum, x) => sum + x.pct, 0) === 100, 'meal shares must add up to 100 %'),
});

// Every field has a default, so profiles saved by older versions keep parsing when fields are added.
export const profileSchema = fields;

export async function getProfile(): Promise<Profile | null> {
  const row = await one<{ data: unknown; updated_at: string }>('SELECT data, updated_at FROM profile WHERE id = 1');
  if (!row) return null;
  const parsed = profileSchema.safeParse(row.data);
  if (!parsed.success) return null;
  return { ...parsed.data, updatedAt: row.updated_at };
}

export async function saveProfile(input: unknown): Promise<Profile> {
  const data = profileSchema.parse(input);
  const ts = nowIso();
  await run(
    'INSERT INTO profile (id, data, updated_at) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    [JSON.stringify(data), ts],
  );
  return { ...data, updatedAt: ts };
}

/** The time zone that decides what "a day" is: the profile's, else the server default. */
export function timeZoneOf(profile: Pick<Profile, 'timeZone'> | null | undefined): string {
  return validTimeZone(profile?.timeZone || undefined) ?? config.timeZone;
}
