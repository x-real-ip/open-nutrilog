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

async function eat(day: string, kcal: number, protein = 100, name = 'x') {
  await run(
    `INSERT INTO diary_entries (id, day, meal_id, name, amount, unit, quantity, kcal, protein, carbs, fat, created_at, updated_at)
     VALUES ($1, $2, 1, $4, $3, 'kcal', 0, $3, $5, 250, 80, now(), now())`,
    [crypto.randomUUID(), day, kcal, name, protein],
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

test('fasting: start (also back in time), change, end; one at a time; history; export', async () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  assert.deepEqual((await call('GET', '/api/fasting')).body, { current: null, recent: [] });

  let r = (await call('POST', '/api/fasting/start', { goalHours: 16, startedAt: hoursAgo(10) })).body;
  assert.equal(r.current.goalHours, 16);
  assert.ok(Math.abs(r.current.hours - 10) < 0.05, String(r.current.hours));
  assert.equal(r.current.reached, false);
  assert.equal((await call('POST', '/api/fasting/start', { goalHours: 16 })).status, 400, 'one at a time');

  // You started earlier than you said: change the start; and the goal.
  r = (await call('PUT', '/api/fasting/current', { startedAt: hoursAgo(17), goalHours: 18 })).body;
  assert.ok(Math.abs(r.current.hours - 17) < 0.05);
  assert.equal(r.current.goalHours, 18);

  r = (await call('POST', '/api/fasting/end', { endedAt: hoursAgo(-0) })).body;
  assert.equal(r.current, null);
  assert.equal(r.recent.length, 1);
  assert.equal(r.recent[0].reached, false, '17 of 18 hours');
  r = (await call('POST', '/api/fasting/start', { goalHours: 12 })).body;
  r = (await call('POST', '/api/fasting/end', {})).body;
  assert.equal(r.recent.length, 2);
  assert.equal(r.recent[0].goalHours, 12, 'newest first');

  // Bad times and states.
  assert.equal((await call('POST', '/api/fasting/end', {})).status, 400, 'nothing running');
  assert.equal((await call('POST', '/api/fasting/start', { goalHours: 16, startedAt: hoursAgo(-2) })).status, 400, 'not in the future');
  assert.equal((await call('POST', '/api/fasting/start', { goalHours: 16, startedAt: hoursAgo(100) })).status, 400, 'at most 72 hours back');
  assert.equal((await call('POST', '/api/fasting/start', { goalHours: 0 })).status, 400);
  await call('POST', '/api/fasting/start', { goalHours: 16, startedAt: hoursAgo(2) });
  assert.equal((await call('POST', '/api/fasting/end', { endedAt: hoursAgo(3) })).status, 400, 'end before start');

  // Export and import keep them; delete one.
  const exported = (await call('GET', '/api/export/json')).body;
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  assert.deepEqual((await call('GET', '/api/fasting')).body, { current: null, recent: [] });
  await call('POST', '/api/import/json', exported);
  r = (await call('GET', '/api/fasting')).body;
  assert.ok(r.current);
  assert.equal(r.recent.length, 2);
  r = (await call('DELETE', `/api/fasting/${r.recent[0].id}`)).body;
  assert.equal(r.recent.length, 1);
});

test('week report: last week by default; complete days only; protein days; trend; top foods', async () => {
  await call('PUT', '/api/profile', spec);
  const wk = weekStart(addDays(today, -7));
  const weigh = (d: string, kg: number) => run('INSERT INTO body_weights (measured_on, weight_kg, created_at) VALUES ($1, $2, now())', [d, kg]);
  await weigh(addDays(wk, -3), 80);
  await weigh(addDays(wk, 6), 78);
  await eat(wk, 1800);
  await eat(addDays(wk, 1), 1500);
  await eat(addDays(wk, 1), 300, 0, '{"en":"Cake","nl":"Taart"}');
  await eat(addDays(wk, 2), 2100);
  await call('PUT', `/api/days/${addDays(wk, 2)}/mark`, { incomplete: true });
  await eat(addDays(wk, 3), 1900, 170);

  const r = (await call('GET', '/api/week-report')).body;
  assert.equal(r.weekStart, wk);
  assert.equal(r.weekEnd, addDays(wk, 6));
  assert.equal(r.previous, addDays(wk, -7));
  assert.equal(r.next, weekStart(today));
  assert.equal(r.days.length, 7);
  assert.deepEqual([r.daysSoFar, r.loggedDays, r.completeDays], [7, 4, 3], 'the incomplete day is logged but not complete');
  assert.equal(r.avgKcal, 1833);
  assert.equal(r.avgTargetKcal, 1982);
  assert.equal(r.balanceKcal, 1800 - 1982 + (1800 - 1982) + (1900 - 1982));
  assert.deepEqual([r.proteinHitDays, r.proteinTargetDays], [1, 3], '170 g reaches 95 % of 160 g; 100 g does not');
  assert.equal(r.avgProteinG, 123);
  assert.equal(r.trainingDays, 0);
  assert.deepEqual([r.trendStartKg, r.trendEndKg, r.trendChangeKg, r.weighIns], [80, 79.8, -0.2, 1]);
  assert.deepEqual(r.topFoods, [
    { name: 'x', kcal: 7300, times: 4 },
    { name: 'Cake', kcal: 300, times: 1 },
  ]);

  // This week has no next; a week still to come gives this week; a bad day is refused.
  const now = (await call('GET', `/api/week-report?day=${today}`)).body;
  assert.equal(now.weekStart, weekStart(today));
  assert.equal(now.next, null);
  assert.equal(now.days.filter((d: any) => d.date <= today).length, now.daysSoFar);
  assert.equal((await call('GET', `/api/week-report?day=${addDays(today, 30)}`)).body.weekStart, weekStart(today));
  assert.equal((await call('GET', '/api/week-report?day=yesterday')).status, 400);
});

test('weekly average and an own target through the API; the week report measures against each day\'s own target', async () => {
  await call('PUT', '/api/profile', { ...spec, weekAverage: true });
  const wk = weekStart(addDays(today, -7));
  await eat(wk, 2582); // 600 over on Monday

  let tue = (await call('GET', `/api/targets/${addDays(wk, 1)}`)).body.target;
  assert.equal(tue.kcal, 1882, '600 over 6 days left');
  assert.deepEqual(tue.carry, { balance: 600, daysLeft: 6, perDay: -100, capped: false });
  assert.ok(tue.steps.some((x: any) => x.id === 'carry'));
  // Tuesday not logged: it counts as on target; Wednesday spreads the 600 over 5 days.
  assert.equal((await call('GET', `/api/targets/${addDays(wk, 2)}`)).body.target.kcal, 1862);
  assert.equal((await call('GET', `/api/targets/${wk}`)).body.target.kcal, 1982, 'Monday itself has nothing before it');
  // An incomplete day doesn't count.
  await call('PUT', `/api/days/${wk}/mark`, { incomplete: true });
  assert.equal((await call('GET', `/api/targets/${addDays(wk, 1)}`)).body.target.kcal, 1982);
  await call('PUT', `/api/days/${wk}/mark`, { incomplete: false });

  // The same in progress and the week report, which measures against the day's own target.
  const r = (await call('GET', `/api/week-report?day=${wk}`)).body;
  assert.deepEqual(r.days.slice(0, 3).map((d: any) => d.targetKcal), [1982, 1882, 1862]);
  assert.equal(r.balanceKcal, 600);
  assert.equal(r.avgTargetKcal, 1982);

  // Off again: no carry.
  await call('PUT', '/api/profile', spec);
  tue = (await call('GET', `/api/targets/${addDays(wk, 1)}`)).body.target;
  assert.equal(tue.kcal, 1982);
  assert.equal(tue.carry, null);

  // Your own target.
  await call('PUT', '/api/profile', { ...spec, kcalOverride: 2100 });
  assert.equal((await call('GET', `/api/targets/${today}`)).body.target.kcal, 2100);
  assert.equal((await call('PUT', '/api/profile', { ...spec, kcalOverride: 500 })).status, 400);
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
