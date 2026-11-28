// Fasting: a timer from the start of a fast to its end, with a goal in hours. At most one fast runs at a time
// (a unique index makes sure). Only times are stored; nothing here changes targets.
import { z } from 'zod';
import type { Fast, FastingState } from '../../shared/types.ts';
import { all, one, run, tx } from '../db.ts';
import { UserError } from '../i18n.ts';

const HOUR = 3_600_000;
/** How far back a start or end may be set: a fast you forgot to start, or to end. */
const MAX_BACK_HOURS = 72;

function toFast(r: { id: number; started_at: string | Date; ended_at: string | Date | null; goal_hours: number }, now = Date.now()): Fast {
  const start = new Date(r.started_at).getTime();
  const end = r.ended_at ? new Date(r.ended_at).getTime() : now;
  const hours = Math.max(0, Math.round(((end - start) / HOUR) * 100) / 100);
  return {
    id: r.id,
    startedAt: new Date(start).toISOString(),
    endedAt: r.ended_at ? new Date(end).toISOString() : null,
    goalHours: r.goal_hours,
    hours,
    reached: hours >= r.goal_hours,
  };
}

export async function getFasting(): Promise<FastingState> {
  const current = await one<any>('SELECT * FROM fasts WHERE ended_at IS NULL');
  const recent = await all<any>('SELECT * FROM fasts WHERE ended_at IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 14');
  return { current: current ? toFast(current) : null, recent: recent.map((r) => toFast(r)) };
}

/** An instant that is not in the future and at most 72 hours back. */
function pastInstant(iso: string | null | undefined, what: { en: string; nl: string }): Date {
  if (!iso) return new Date();
  const t = new Date(iso);
  const now = Date.now();
  if (Number.isNaN(t.getTime()) || t.getTime() > now + 60_000 || t.getTime() < now - MAX_BACK_HOURS * HOUR)
    throw new UserError(400, `The ${what.en} has to be in the last ${MAX_BACK_HOURS} hours, not in the future.`, `De ${what.nl} moet in de laatste ${MAX_BACK_HOURS} uur liggen, niet in de toekomst.`);
  return t;
}

const START = { en: 'start', nl: 'starttijd' };
const END = { en: 'end', nl: 'eindtijd' };

export const startSchema = z.object({ goalHours: z.number().int().min(1).max(72), startedAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict();

export async function startFast(raw: unknown): Promise<FastingState> {
  const input = startSchema.parse(raw);
  const startedAt = pastInstant(input.startedAt, START);
  await tx(async (c) => {
    if (await one('SELECT 1 FROM fasts WHERE ended_at IS NULL FOR UPDATE', [], c)) throw new UserError(400, 'A fast is already running.', 'Er loopt al een vasten.');
    await run('INSERT INTO fasts (started_at, goal_hours) VALUES ($1, $2)', [startedAt, input.goalHours], c);
  });
  return getFasting();
}

export const changeSchema = z.object({ goalHours: z.number().int().min(1).max(72).optional(), startedAt: z.iso.datetime({ offset: true }).optional() }).strict();

/** Changes the running fast: its start (you started earlier) or its goal. */
export async function changeFast(raw: unknown): Promise<FastingState> {
  const input = changeSchema.parse(raw);
  const current = await one<any>('SELECT * FROM fasts WHERE ended_at IS NULL');
  if (!current) throw new UserError(400, 'No fast is running.', 'Er loopt geen vasten.');
  const startedAt = input.startedAt ? pastInstant(input.startedAt, START) : new Date(current.started_at);
  await run('UPDATE fasts SET started_at = $2, goal_hours = $3 WHERE id = $1', [current.id, startedAt, input.goalHours ?? current.goal_hours]);
  return getFasting();
}

export const endSchema = z.object({ endedAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict();

export async function endFast(raw: unknown): Promise<FastingState> {
  const input = endSchema.parse(raw ?? {});
  const endedAt = pastInstant(input.endedAt, END);
  const current = await one<any>('SELECT * FROM fasts WHERE ended_at IS NULL');
  if (!current) throw new UserError(400, 'No fast is running.', 'Er loopt geen vasten.');
  if (endedAt.getTime() < new Date(current.started_at).getTime()) throw new UserError(400, 'The end is before the start.', 'Het einde ligt voor de start.');
  await run('UPDATE fasts SET ended_at = $2 WHERE id = $1', [current.id, endedAt]);
  return getFasting();
}

export async function deleteFast(id: number): Promise<FastingState> {
  await run('DELETE FROM fasts WHERE id = $1', [id]);
  return getFasting();
}
