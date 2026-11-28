// Targets through the API: profile, weigh-ins, training marks, the adaptive maintenance and progress.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

const { config } = await import('../config.ts');
const { openDb, closeDb, run } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { addDays } = await import('../services/days.ts');
const { weekStart, setWorkoutSource } = await import('../services/dayTargets.ts');

await openDb(testDb.url);
await initAuth();
const app = await buildApp();
config.auth.mode = 'none';

after(async () => {
  await app.close();
  await closeDb();
  await testDb.stop();
});

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any });
  return { status: res.statusCode, body: res.json() };
};

/** The spec example's person. */
const spec = { name: 'Spec', language: 'en', timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5, trainingMinutes: 45 };

let today = '';
beforeEach(async () => {
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  setWorkoutSource(async () => new Map());
  today = (await call('GET', '/api/info')).body.today;
});

async function eat(day: string, kcal: number) {
  await run(
    `INSERT INTO diary_entries (id, day, meal_id, name, amount, unit, quantity, kcal, protein, carbs, fat, created_at, updated_at)
     VALUES ($1, $2, 1, 'x', $3, 'kcal', 0, $3, 100, 250, 80, now(), now())`,
    [crypto.randomUUID(), day, kcal],
  );
}

test('no target until sex, age, height and weight are known', async () => {
  let r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.target, null);
  assert.deepEqual(r.missing, ['sex', 'age', 'heightCm', 'weightKg']);
  await call('PUT', '/api/profile', { name: '', language: 'en', sex: 'female', age: 30, heightCm: 165 });
  r = (await call('GET', `/api/targets/${today}`)).body;
  assert.deepEqual(r.missing, ['weightKg']);
  await call('POST', '/api/body-weights', { weightKg: 60 });
  r = (await call('GET', `/api/targets/${today}`)).body;
  assert.deepEqual(r.missing, [], 'a weigh-in is a weight');
  assert.ok(r.target.kcal > 0);
});

test('spec example through the API: 1982 on a rest day, 2222 once marked as a training day', async () => {
  await call('PUT', '/api/profile', spec);
  let r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.target.kcal, 1982);
  assert.equal(r.target.proteinG, 160);
  assert.equal(r.target.isTrainingDay, false);
  assert.equal(r.target.baseSource, 'formula');
  assert.equal(r.adaptive.status, 'not_enough');
  assert.ok(r.target.steps.some((s: any) => s.id === 'bmr' && /1730 kcal/.test(s.text)));

  r = (await call('PUT', `/api/days/${today}/mark`, { training: true })).body;
  assert.equal(r.mark.training, true);
  assert.equal(r.target.kcal, 2222);
  assert.deepEqual(r.target.workout, { minutes: 45, source: 'planned' });

  r = (await call('PUT', `/api/days/${today}/mark`, { training: null })).body;
  assert.equal(r.target.kcal, 1982);
  assert.equal((await call('PUT', `/api/days/${today}/mark`, { training: 'yes' })).status, 400);
});

test('higher days and meal shares through the API; shares must add up to 100 %', async () => {
  await call('PUT', '/api/profile', { ...spec, shiftDays: [6, 7], shiftKcal: 300, mealShares: [{ mealId: 1, pct: 25 }, { mealId: 2, pct: 35 }, { mealId: 3, pct: 30 }, { mealId: 4, pct: 10 }] });
  const sat = (await call('GET', '/api/targets/2026-11-28')).body;
  assert.equal(sat.target.kcal, 2282);
  assert.ok(sat.target.steps.some((x: any) => x.id === 'shift'));
  assert.deepEqual(sat.meals.map((m: any) => [m.mealId, m.kcal]), [[1, 571], [2, 799], [3, 685], [4, 228]]);
  assert.equal((await call('GET', '/api/targets/2026-11-23')).body.target.kcal, 1862);

  // A hidden meal's share goes to the others.
  await call('PUT', '/api/meals/4', { name: 'Snacks', hidden: true });
  assert.deepEqual((await call('GET', '/api/targets/2026-11-28')).body.meals.map((m: any) => m.mealId), [1, 2, 3]);

  assert.equal((await call('PUT', '/api/profile', { ...spec, mealShares: [{ mealId: 1, pct: 50 }, { mealId: 2, pct: 40 }] })).status, 400);
  assert.equal((await call('PUT', '/api/profile', { ...spec, shiftDays: [6, 6], shiftKcal: 300 })).status, 400);
  assert.equal((await call('PUT', '/api/profile', { ...spec, shiftDays: [1, 2, 3, 4, 5, 6, 7], shiftKcal: 300 })).status, 400);
  // Without shares, no meal targets.
  await call('PUT', '/api/profile', spec);
  assert.deepEqual((await call('GET', '/api/targets/2026-11-28')).body.meals, []);
});

test('a linked workout makes it a training day; "not a training day" overrides it', async () => {
  await call('PUT', '/api/profile', spec);
  setWorkoutSource(async (from, to) => new Map(from <= today && today <= to ? [[today, { minutes: 45, source: 'finished' as const }]] : []));
  let r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.target.kcal, 2222);
  assert.equal(r.target.workout.source, 'finished');
  r = (await call('PUT', `/api/days/${today}/mark`, { training: false })).body;
  assert.equal(r.target.kcal, 1982);
  // An unreachable source just means no linked workouts.
  setWorkoutSource(async () => {
    throw new Error('down');
  });
  await call('PUT', `/api/days/${today}/mark`, { training: null });
  assert.equal((await call('GET', `/api/targets/${today}`)).body.target.kcal, 1982);
});

test('body weight: the latest weigh-in is the profile weight; editing the profile weight logs it', async () => {
  await call('PUT', '/api/profile', spec);
  let entries = (await call('GET', '/api/body-weights')).body.entries;
  assert.deepEqual(entries.map((e: any) => [e.date, e.weightKg]), [[today, 80]], 'the profile weight was logged for today');

  await call('POST', '/api/body-weights', { weightKg: 79.04, date: addDays(today, -1) });
  await call('POST', '/api/body-weights', { weightKg: 78.5 });
  entries = (await call('GET', '/api/body-weights')).body.entries;
  assert.deepEqual(entries.map((e: any) => e.weightKg), [79, 78.5], 'one per day, one decimal');
  assert.equal((await call('GET', '/api/profile')).body.profile.weightKg, 78.5);
  // Yesterday's target uses yesterday's weight.
  const y = (await call('GET', `/api/targets/${addDays(today, -1)}`)).body.target;
  assert.ok(y.steps[0].text.includes('79 kg'));

  entries = (await call('DELETE', `/api/body-weights/${entries[1].id}`)).body.entries;
  assert.equal((await call('GET', '/api/profile')).body.profile.weightKg, 79);
  assert.equal((await call('POST', '/api/body-weights', { weightKg: 10 })).status, 400);
});

test('adaptive maintenance after 28 days of stable weight on 2600 kcal, at most 150 kcal from last week', async () => {
  await call('PUT', '/api/profile', spec);
  for (let i = 1; i <= 28; i++) {
    await eat(addDays(today, -i), 2600);
    await run('INSERT INTO body_weights (measured_on, weight_kg, created_at) VALUES ($1, 80, now()) ON CONFLICT DO NOTHING', [addDays(today, -i)]);
  }
  let r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.adaptive.status, 'ok');
  assert.equal(r.adaptive.base, 2600);
  assert.equal(r.target.baseSource, 'adaptive');
  assert.equal(r.target.kcal, 2600 - 440);

  // Last week the estimate was 2422: this week it may only move 150 kcal.
  await run(`INSERT INTO tdee_history (week_start, base_kcal, formula_kcal, adaptive_kcal, updated_at) VALUES ($1, 2422, 2422, 2422, now())`, [addDays(weekStart(today), -7)]);
  r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.adaptive.base, 2572);
  assert.equal(r.target.kcal, 2572 - 440);

  // Incomplete days are left out: mark enough of them and it falls back to the formula.
  for (let i = 1; i <= 20; i++) await call('PUT', `/api/days/${addDays(today, -i)}/mark`, { incomplete: true });
  r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.adaptive.status, 'not_enough');
  assert.equal(r.target.kcal, 1982);
});

test('progress: intake against target per day and week, weight trend, averages', async () => {
  await call('PUT', '/api/profile', spec);
  for (let i = 1; i <= 10; i++) {
    await eat(addDays(today, -i), 2000);
    await run('INSERT INTO body_weights (measured_on, weight_kg, created_at) VALUES ($1, $2, now()) ON CONFLICT (measured_on) DO NOTHING', [addDays(today, -i), 80 + i * 0.1]);
  }
  await call('PUT', `/api/days/${addDays(today, -2)}/mark`, { training: true });
  const p = (await call('GET', '/api/progress?days=14')).body;
  assert.equal(p.days.length, 14);
  assert.equal(p.days.at(-1).date, today);
  const yesterday = p.days.at(-2);
  assert.equal(yesterday.kcal, 2000);
  assert.equal(yesterday.logged, true);
  // Each day's target uses that day's weight (80.1 kg yesterday), so it is close to the spec's 1982.
  assert.ok(Math.abs(yesterday.targetKcal - 1982) <= 3, String(yesterday.targetKcal));
  assert.ok(p.days.at(-3).targetKcal - yesterday.targetKcal >= 240, 'the training day has the higher target');
  assert.equal(p.days.at(-3).isTrainingDay, true);
  assert.equal(p.days[0].logged, false);

  assert.equal(p.weights.length, 11, 'ten weigh-ins plus today from the profile');
  assert.ok(p.weights.every((w: any) => typeof w.trendKg === 'number'));
  assert.ok(p.weeklyChangeKg < 0, 'losing weight');
  assert.deepEqual(p.averages, { days: 7, kcal: 2000, proteinG: 100, carbsG: 250, fatG: 80 });
  assert.ok(p.weeks.length >= 2);
  assert.ok(p.weeks.some((w: any) => w.avgKcal === 2000));
  assert.ok(p.tdee.some((t: any) => t.weekStart === weekStart(today) && t.baseKcal === 2422));
  assert.equal((await call('GET', '/api/progress?days=2')).status, 400);
});

test('marks, weights and the maintenance history survive export and import', async () => {
  await call('PUT', '/api/profile', spec);
  await call('PUT', `/api/days/${today}/mark`, { training: true, incomplete: true });
  await call('GET', `/api/targets/${today}`);
  const exported = (await call('GET', '/api/export/json')).body;
  assert.equal(exported.tables.day_marks.length, 1);
  assert.equal(exported.tables.tdee_history.length, 1);
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  await call('POST', '/api/import/json', exported);
  const r = (await call('GET', `/api/targets/${today}`)).body;
  assert.deepEqual(r.mark, { training: true, incomplete: true });
  assert.equal(r.target.kcal, 2222);
  assert.equal((await call('GET', '/api/body-weights')).body.entries.length, 1);
});
