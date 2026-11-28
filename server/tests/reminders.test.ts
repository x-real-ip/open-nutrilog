// Push reminders against a fake push service: device subscriptions, a meal with nothing logged, the weigh-in, the
// day's summary, once a day and only within half an hour of their time.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

const { config } = await import('../config.ts');
const { openDb, closeDb, one, run } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { setPushSender } = await import('../services/push.ts');
const { checkReminders, isDue, resetReminderClaims } = await import('../services/reminders.ts');

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

const sent: { endpoint: string; payload: any }[] = [];
setPushSender(async (sub, payload) => {
  if (sub.endpoint.endsWith('/gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  return 201;
});

// A throwaway subscription key pair (a P-256 public key and a 16-byte auth secret).
const ecdh = crypto.createECDH('prime256v1');
const keys = { p256dh: ecdh.generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
const DAY = '2026-11-27';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00Z`);
const profile = {
  name: 'Test',
  language: 'en',
  timeZone: 'UTC',
  sex: 'male',
  age: 40,
  heightCm: 180,
  weightKg: 80,
  neat: 1.4,
  phase: 'cut',
  ratePctPerWeek: 0.5,
  reminders: { meals: [{ mealId: 2, time: '13:00' }], weighIn: '08:00', summary: '21:00' },
};

beforeEach(async () => {
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  await resetReminderClaims();
  await run(`DELETE FROM settings WHERE key LIKE 'push:%'`);
  sent.length = 0;
});

test('due: from its time, for half an hour', () => {
  assert.equal(isDue('13:00', '12:59'), false);
  assert.equal(isDue('13:00', '13:00'), true);
  assert.equal(isDue('13:00', '13:29'), true);
  assert.equal(isDue('13:00', '13:30'), false);
});

test('subscriptions: a VAPID key, saved per device, a test push; a dead one is dropped', async () => {
  const key = (await call('GET', '/api/push/key')).body.publicKey;
  assert.match(key, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await call('GET', '/api/push/key')).body.publicKey, key, 'the same key every time');
  assert.equal((await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/phone', keys })).status, 200);
  assert.equal((await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/phone', keys })).status, 200, 'again is fine');
  await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/gone', keys });
  assert.equal((await call('POST', '/api/push/test')).body.sent, 1);
  assert.equal((await call('POST', '/api/push/test')).body.sent, 1, 'the dead one is gone');
  assert.equal((await call('POST', '/api/push/subscriptions', { endpoint: 'not a url', keys })).status, 400);
  await call('DELETE', '/api/push/subscriptions', { endpoint: 'https://push.example/phone' });
  assert.equal((await call('POST', '/api/push/test')).body.sent, 0);
  // Device subscriptions never go into an export.
  await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/phone', keys });
  assert.doesNotMatch(JSON.stringify((await call('GET', '/api/export/json')).body), /push\.example/);
});

test('reminders: a meal with nothing logged, the weigh-in, the summary; once a day, only in their window', async () => {
  await call('PUT', '/api/profile', profile);
  // Nothing goes out without a device.
  assert.deepEqual(await checkReminders(at('13:05')), []);
  await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/phone', keys });

  // The profile logged today's weight (80 kg) on save; take it away so the weigh-in reminder has a reason.
  await run('DELETE FROM body_weights');
  assert.deepEqual((await checkReminders(at('08:10'))).map((m) => m.tag), ['weigh-in']);
  assert.deepEqual(await checkReminders(at('08:20')), [], 'once a day');

  // Lunch: nothing logged at 13:05 → a reminder; too late at 13:45 the next day.
  const [lunch] = await checkReminders(at('13:05'));
  assert.deepEqual(lunch, { title: 'Lunch', body: 'Nothing logged for lunch yet. Tap to add it.', tag: 'meal-2', url: '/diary' });

  // The summary in the evening, with the target.
  await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 3, productId: null, amount: 900, unit: 'kcal', quick: { name: 'Dinner', kcal: 900, protein: 60, carbs: null, fat: null } });
  const [summary] = await checkReminders(at('21:00'));
  assert.equal(summary.tag, 'summary');
  assert.match(summary.body, /^900 of \d+ kcal · protein 60 of 160 g$/);
  assert.equal(sent.length, 3);

  // A logged meal gets no reminder; a reminder past its window isn't sent.
  await resetReminderClaims();
  await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 2, productId: null, amount: 500, unit: 'kcal', quick: { name: 'Lunch', kcal: 500, protein: 30, carbs: null, fat: null } });
  assert.deepEqual(await checkReminders(at('13:10')), []);
  assert.deepEqual(await checkReminders(at('21:45')), []);
  assert.ok(await one(`SELECT 1 FROM settings WHERE key = 'reminder:meal:2'`));
});

test('reminders: in Dutch, and bad times are refused', async () => {
  await call('PUT', '/api/profile', { ...profile, language: 'nl' });
  await call('POST', '/api/push/subscriptions', { endpoint: 'https://push.example/phone', keys });
  const [lunch] = await checkReminders(at('13:00'));
  assert.equal(lunch.body, 'Nog niets gelogd bij lunch. Tik om het toe te voegen.');
  assert.equal((await call('PUT', '/api/profile', { ...profile, reminders: { meals: [], weighIn: '25:00', summary: null } })).status, 400);
  assert.equal((await call('PUT', '/api/profile', { ...profile, reminders: { meals: [{ mealId: 1, time: '8:00' }] } })).status, 400);
});
