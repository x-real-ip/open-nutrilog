import { z } from 'zod';
import type { Profile } from '../../shared/types.ts';
import { config, validTimeZone } from '../config.ts';
import { nowIso, one, run } from '../db.ts';
import { DEFAULT_MET, DEFAULT_NEAT } from './targets.ts';

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
  fasting: z.boolean().default(false),
  fastingGoalHours: z.number().int().min(1).max(72).default(16),
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
