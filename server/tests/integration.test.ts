// The link with Open Strength: token-only integration API, workouts making training days, weigh-ins in both
// directions (outbox while Open Strength is down, a one-time import), and quiet degradation.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

// A fake Open Strength.
const received: { method: string; url: string; auth: string; body: string }[] = [];
let strengthDown = false;
let workouts: unknown[] = [];
const strengthWeights = [
  { date: '2026-10-01', weightKg: 82.4 },
  { date: '2026-10-08', weightKg: 81.9 },
];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (strengthDown) {
      res.writeHead(503).end();
      return;
    }
    received.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body });
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/integration/v1/profile') res.end(JSON.stringify({ goal: 'hypertrophy', level: 'intermediate', age: 40, heightCm: 180, weightKg: 82, language: 'en' }));
    else if (url.pathname === '/api/integration/v1/workouts') res.end(JSON.stringify(workouts));
    else if (url.pathname === '/api/integration/v1/body-weights' && req.method === 'GET') res.end(JSON.stringify(strengthWeights));
    else res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${(fake.address() as any).port}`;

const { config } = await import('../config.ts');
const { openDb, closeDb, run } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { addDays } = await import('../services/days.ts');
const { clearStrengthCache, flushOutbox } = await import('../services/strength.ts');

await openDb(testDb.url);
await initAuth();
const app = await buildApp();

after(async () => {
  await app.close();
  fake.close();
  await closeDb();
  await testDb.stop();
});

const TOKEN = 'strength-to-nutrilog-token';
const bearer = { authorization: `Bearer ${TOKEN}` };
const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body };
};

const spec = { name: 'Spec', language: 'en', timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5, trainingMinutes: 60 };

function link(on: boolean) {
  config.integration.token = on ? TOKEN : '';
  config.integration.strengthUrl = on ? fakeUrl : '';
  config.integration.strengthToken = on ? 'nutrilog-to-strength-token' : '';
  clearStrengthCache();
}

let today = '';
beforeEach(async () => {
  config.auth.mode = 'none';
  link(false);
  strengthDown = false;
  workouts = [];
  received.length = 0;
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  await run('DELETE FROM integration_outbox');
  await run(`DELETE FROM settings WHERE key = 'strength_weights_imported'`);
  today = (await call('GET', '/api/info')).body.today;
});

test('integration API: 404 without a token, 401 with a wrong one or only a session, 200 with the right one', async () => {
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, bearer)).status, 404);
  link(true);
  assert.equal((await call('GET', '/api/integration/v1/phase')).status, 401);
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, bearer)).status, 200);

  config.auth.mode = 'password';
  config.auth.password = 'pw';
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw' } });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.equal((await call('GET', '/api/profile', undefined, { cookie })).status, 200);
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, { cookie })).status, 401, 'a session is not a token');
  config.auth.mode = 'proxy';
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, { 'x-authentik-username': 'coen' })).status, 401);
});

test('days and phase: intake against target, deficit against maintenance, protein per kg', async () => {
  link(true);
  assert.equal((await call('GET', '/api/integration/v1/phase', undefined, bearer)).body, null, 'no profile: no phase');
  await call('PUT', '/api/profile', spec);
  for (let i = 1; i <= 3; i++) {
    await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: addDays(today, -i), mealId: 1, productId: null, amount: 1800, unit: 'kcal', quick: { name: '', kcal: 1800, protein: 120, carbs: null, fat: null } });
  }
  const days = (await call('GET', `/api/integration/v1/days?from=${addDays(today, -3)}&to=${today}`, undefined, bearer)).body;
  assert.equal(days.length, 4);
  assert.deepEqual(days[0], { date: addDays(today, -3), kcal: 1800, proteinG: 120, carbsG: 0, fatG: 0, targetKcal: 1982, targetProteinG: 160, isTrainingDay: false, complete: true });
  assert.equal(days[3].complete, false, 'nothing logged today');

  const phase = (await call('GET', '/api/integration/v1/phase', undefined, bearer)).body;
  assert.deepEqual(phase, {
    phase: 'cut',
    ratePctPerWeek: 0.5,
    estimatedTdee: 2422,
    proteinGPerKg: 2,
    avgProteinGPerKg14d: 1.5,
    avgEnergyBalance14d: 1800 - 2422,
    loggedDays14d: 3,
  });
  assert.equal((await call('GET', `/api/integration/v1/days?from=${today}&to=${addDays(today, -1)}`, undefined, bearer)).status, 400);
});

test('workouts from Open Strength make training days; a finished one counts its real length', async () => {
  link(true);
  await call('PUT', '/api/profile', spec);
  workouts = [{ id: 7, date: today, startedAt: '', finishedAt: '', status: 'completed', durationMinutes: 45, dayName: 'Full body A', isDeload: false, totalSets: 18, volumeKg: 9000 }];
  const r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.target.kcal, 2222, 'the spec example: 45 minutes add 240 kcal');
  assert.deepEqual(r.target.workout, { minutes: 45, source: 'finished' });
  assert.ok(received.some((x) => x.url.startsWith('/api/integration/v1/workouts?') && x.auth === 'Bearer nutrilog-to-strength-token'));

  // "Not a training day" wins; and the PWA sees today's workout.
  assert.equal((await call('PUT', `/api/days/${today}/mark`, { training: false })).body.target.kcal, 1982);
  const linkedNow = (await call('GET', '/api/linked/strength')).body;
  assert.equal(linkedNow.status, 'ok');
  assert.equal(linkedNow.todayWorkouts[0].dayName, 'Full body A');
  assert.equal(linkedNow.profile.goal, 'hypertrophy');
});

test('Open Strength down: targets fall back quickly to the days you mark yourself', async () => {
  link(true);
  await call('PUT', '/api/profile', spec);
  config.integration.strengthUrl = 'http://127.0.0.1:9';
  const started = Date.now();
  let r = (await call('GET', `/api/targets/${today}`)).body;
  assert.equal(r.target.kcal, 1982);
  assert.ok(Date.now() - started < 3000);
  r = (await call('PUT', `/api/days/${today}/mark`, { training: true })).body;
  assert.equal(r.target.kcal, 1982 + 320, 'your usual 60 minutes');
  assert.equal((await call('GET', '/api/linked/strength')).body.status, 'unreachable');
  link(false);
  assert.equal((await call('GET', '/api/linked/strength')).body.status, 'off');
});

test('weigh-ins go to Open Strength (an outbox while it is down); its weigh-ins come in without an echo', async () => {
  link(true);
  await call('PUT', '/api/profile', { ...spec, weightKg: null });
  await call('POST', '/api/body-weights', { weightKg: 79.6, date: '2026-11-20' });
  const put = received.find((r) => r.method === 'PUT');
  assert.equal(put?.url, '/api/integration/v1/body-weights/2026-11-20');
  assert.deepEqual(JSON.parse(put!.body), { weightKg: 79.6 });

  strengthDown = true;
  const entries = (await call('POST', '/api/body-weights', { weightKg: 79.2, date: '2026-11-21' })).body.entries;
  await call('DELETE', `/api/body-weights/${entries[0].id}`);
  strengthDown = false;
  received.length = 0;
  assert.equal(await flushOutbox(), 2);
  assert.deepEqual(received.map((r) => `${r.method} ${r.url}`), ['PUT /api/integration/v1/body-weights/2026-11-21', 'DELETE /api/integration/v1/body-weights/2026-11-20']);

  // From Open Strength: stored, profile follows, nothing sent back.
  received.length = 0;
  await call('PUT', '/api/integration/v1/body-weights/2026-11-22', { weightKg: 78.9 }, bearer);
  assert.equal((await call('GET', '/api/profile')).body.profile.weightKg, 78.9);
  await call('DELETE', '/api/integration/v1/body-weights/2026-11-22', undefined, bearer);
  assert.equal((await call('GET', '/api/profile')).body.profile.weightKg, 79.2);
  assert.ok(!received.some((r) => r.url.includes('body-weights')));
});

test('first link: Open Strength\'s weigh-ins come over once; days with a weigh-in here keep theirs', async () => {
  await call('PUT', '/api/profile', { ...spec, weightKg: null });
  await call('POST', '/api/body-weights', { weightKg: 83, date: '2026-10-08' });
  link(true);
  await call('GET', '/api/linked/strength');
  let entries = (await call('GET', '/api/body-weights')).body.entries;
  assert.deepEqual(entries.map((e: any) => [e.date, e.weightKg]), [['2026-10-01', 82.4], ['2026-10-08', 83]]);
  strengthWeights.push({ date: '2026-10-15', weightKg: 81 });
  await call('GET', '/api/linked/strength');
  entries = (await call('GET', '/api/body-weights')).body.entries;
  assert.equal(entries.length, 2, 'only once');
});
