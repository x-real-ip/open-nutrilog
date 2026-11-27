// The link with Open Strength (the training app). Optional: without STRENGTH_URL and STRENGTH_TOKEN everything
// works on its own. Calls have a short timeout, answers are cached for a minute, and nothing here throws: when
// Open Strength is down the link is "not reachable" and targets fall back to the days you mark yourself.
//
// What the link does here:
// - Workouts (in progress or finished) make a day a training day and add their energy to the target.
// - This app owns body weight: weigh-ins are sent to Open Strength (queued in integration_outbox while it is
//   down), so its starting weights use your current weight. On the first link, Open Strength's history is
//   imported once.
// - Open Strength's profile prefills age, height and weight, and its goal is compared with the phase here.
import { config } from '../config.ts';
import { all, getSetting, one, run } from '../db.ts';
import { loc, type Localized } from '../i18n.ts';
import { DAY_PATTERN } from './days.ts';
import type { Phase } from './targets.ts';
import type { Workout } from './targets.ts';

export type LinkStatus = 'off' | 'ok' | 'unreachable';

export interface StrengthWorkout {
  id: number;
  date: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'in_progress' | 'completed';
  durationMinutes: number;
  dayName: string;
  isDeload: boolean;
  totalSets: number;
  volumeKg: number;
}

export interface StrengthProfile {
  goal: 'hypertrophy' | 'strength' | 'conditioning' | 'fat_loss';
  level: string;
  age: number;
  heightCm: number;
  weightKg: number;
  language: 'en' | 'nl';
}

export function linked(): boolean {
  return Boolean(config.integration.strengthUrl && config.integration.strengthToken);
}

let lastStatus: LinkStatus = 'off';
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 60_000;
/** After a failed call the other app is left alone for a while, so pages don't each wait for the timeout. */
const RETRY_AFTER_MS = 15_000;
let failedAt = 0;

export function clearStrengthCache() {
  cache.clear();
  failedAt = 0;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.integration.strengthUrl}/api/integration/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.integration.strengthToken}`,
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.integration.timeoutMs),
  });
  if (!res.ok) throw new Error(`Open Strength answered ${res.status}`);
  lastStatus = 'ok';
  return (await res.json()) as T;
}

async function cachedGet<T>(path: string): Promise<T | null> {
  if (!linked()) {
    lastStatus = 'off';
    return null;
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  if (Date.now() - failedAt < RETRY_AFTER_MS) {
    lastStatus = 'unreachable';
    return null;
  }
  try {
    const value = await call<T>('GET', path);
    cache.set(path, { at: Date.now(), value });
    return value;
  } catch {
    lastStatus = 'unreachable';
    failedAt = Date.now();
    return null;
  }
}

export async function strengthProfile(): Promise<StrengthProfile | null> {
  return cachedGet<StrengthProfile>('/profile');
}

export async function linkStatus(): Promise<LinkStatus> {
  if (!linked()) return 'off';
  await strengthProfile();
  return lastStatus;
}

export async function strengthWorkouts(from: string, to: string): Promise<StrengthWorkout[]> {
  return (await cachedGet<StrengthWorkout[]>(`/workouts?from=${from}&to=${to}`)) ?? [];
}

/**
 * Workouts per day for the target engine: the minutes of that day's workouts added up (the engine caps them at
 * two hours), "in progress" while one is running.
 */
export async function workoutsByDay(from: string, to: string): Promise<Map<string, Workout>> {
  const out = new Map<string, Workout>();
  for (const w of await strengthWorkouts(from, to)) {
    const cur = out.get(w.date);
    out.set(w.date, {
      minutes: (cur?.minutes ?? 0) + w.durationMinutes,
      source: cur?.source === 'in_progress' || w.status === 'in_progress' ? 'in_progress' : 'finished',
    });
  }
  return out;
}

/** A gentle note when the training goal and the nutrition phase pull different ways. Neither app changes the other. */
export function goalClash(goal: StrengthProfile['goal'] | undefined, phase: Phase, ratePctPerWeek: number): Localized | null {
  if ((goal === 'hypertrophy' || goal === 'strength') && phase === 'cut' && ratePctPerWeek >= 0.75) {
    return loc(
      'Open Strength has you training to build muscle or strength, while you are cutting fast here. Expect slower progress in the gym, or choose a slower pace.',
      'In Open Strength train je voor spiermassa of kracht, terwijl je hier snel afvalt. Reken op tragere vooruitgang in de sportschool, of kies een rustiger tempo.',
    );
  }
  if (goal === 'fat_loss' && phase === 'bulk') {
    return loc('Open Strength has fat loss as your training goal, while you are building here.', 'In Open Strength is vetverlies je trainingsdoel, terwijl je hier aankomt.');
  }
  return null;
}

// ---------- Body weight: this app owns it ----------

/** Sends a weigh-in (or its removal) to Open Strength; queues it when that fails. Never throws. */
export async function sendWeight(day: string, weightKg: number | null): Promise<void> {
  if (!linked()) return;
  try {
    if (weightKg === null) await call('DELETE', `/body-weights/${day}`);
    else await call('PUT', `/body-weights/${day}`, { weightKg });
  } catch (err) {
    lastStatus = 'unreachable';
    await run('INSERT INTO integration_outbox (kind, day, weight_kg, last_error) VALUES ($1, $2, $3, $4)', [
      weightKg === null ? 'weight_delete' : 'weight_put',
      day,
      weightKg,
      (err as Error).message.slice(0, 200),
    ]).catch(() => {});
  }
}

/** Retries what is queued, oldest first; stops at the first failure so the order is kept. */
export async function flushOutbox(): Promise<number> {
  if (!linked()) return 0;
  const rows = await all<{ id: number; kind: string; day: string; weight_kg: number | null }>('SELECT id, kind, day, weight_kg FROM integration_outbox ORDER BY id');
  let sent = 0;
  for (const r of rows) {
    try {
      if (r.kind === 'weight_delete') await call('DELETE', `/body-weights/${r.day}`);
      else await call('PUT', `/body-weights/${r.day}`, { weightKg: r.weight_kg });
      await run('DELETE FROM integration_outbox WHERE id = $1', [r.id]);
      sent++;
    } catch (err) {
      lastStatus = 'unreachable';
      await run('UPDATE integration_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [r.id, (err as Error).message.slice(0, 200)]);
      break;
    }
  }
  return sent;
}

export async function outboxSize(): Promise<number> {
  return (await one<{ n: number }>('SELECT count(*)::int AS n FROM integration_outbox'))!.n;
}

/**
 * The first time the apps are linked, Open Strength's weigh-ins come over once (days that already have a weigh-in
 * here keep theirs). After that this app is the source and Open Strength only receives.
 */
export async function importStrengthWeightsOnce(today: string): Promise<number> {
  if (!linked() || (await getSetting('strength_weights_imported'))) return 0;
  let list: { date: string; weightKg: number }[];
  try {
    list = await call('GET', `/body-weights?from=2000-01-01&to=${today}`);
  } catch {
    lastStatus = 'unreachable';
    return 0;
  }
  let added = 0;
  for (const w of list) {
    if (!DAY_PATTERN.test(w.date) || !(w.weightKg >= 30 && w.weightKg <= 300)) continue;
    added += await run(
      'INSERT INTO body_weights (measured_on, weight_kg, created_at) VALUES ($1, $2, now()) ON CONFLICT (measured_on) DO NOTHING',
      [w.date, Math.round(w.weightKg * 10) / 10],
    );
  }
  await run(`INSERT INTO settings (key, value) VALUES ('strength_weights_imported', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [new Date().toISOString()]);
  return added;
}

let timer: NodeJS.Timeout | null = null;

/** Retries the outbox every minute (one replica; started by index.ts). */
export function startOutboxRetry() {
  if (timer || !linked()) return;
  timer = setInterval(() => void flushOutbox().catch(() => {}), 60_000);
  timer.unref();
}
