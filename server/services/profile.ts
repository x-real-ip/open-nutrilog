import { z } from 'zod';
import type { Profile } from '../../shared/types.ts';
import { config, validTimeZone } from '../config.ts';
import { nowIso, one, run } from '../db.ts';

const fields = z.object({
  name: z.string().trim().max(60).default(''),
  language: z.enum(['en', 'nl']).default('en'),
  timeZone: z
    .string()
    .trim()
    .max(64)
    .default('')
    .refine((tz) => tz === '' || validTimeZone(tz) !== undefined, 'unknown time zone'),
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
