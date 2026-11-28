import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

const { config } = await import('../config.ts');
const { openDb, closeDb, migrate } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { addDays, dayOf, daysBetween } = await import('../services/days.ts');

await openDb(testDb.url);
await initAuth();
const app = await buildApp();
config.auth.mode = 'none';

after(async () => {
  await app.close();
  await closeDb();
  await testDb.stop();
});

test('healthz reports the database', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', database: 'ok' });
});

test('migrations are idempotent', async () => {
  const { from, to } = await migrate();
  assert.equal(from, to, 'a second run changes nothing');
});

test('info: English and the default time zone until a profile says otherwise', async () => {
  const info = (await app.inject({ method: 'GET', url: '/api/info' })).json();
  assert.equal(info.language, 'en');
  assert.equal(info.timeZone, 'Europe/Amsterdam');
  assert.match(info.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(info.authRequired, false);
});

test('profile: the defaults a new profile starts with come from the server, and save as they are', async () => {
  const { defaults } = (await app.inject({ method: 'GET', url: '/api/profile' })).json();
  assert.equal(defaults.neat, 1.4);
  assert.equal(defaults.phase, 'maintain');
  assert.equal(defaults.updatedAt, undefined);
  const saved = await app.inject({ method: 'PUT', url: '/api/profile', payload: defaults });
  assert.equal(saved.statusCode, 200, saved.body);
});

test('profile: saving the language switches errors to Dutch', async () => {
  const saved = await app.inject({ method: 'PUT', url: '/api/profile', payload: { name: 'Test', language: 'nl' } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().profile.timeZone, '', 'empty means the server default');
  assert.equal((await app.inject({ method: 'GET', url: '/api/info' })).json().language, 'nl');

  const bad = await app.inject({ method: 'PUT', url: '/api/profile', payload: { language: 'nl', timeZone: 'Mars/Olympus' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /^Ongeldige invoer/);
});

test('profile: a time zone of its own changes what "today" is', async () => {
  await app.inject({ method: 'PUT', url: '/api/profile', payload: { language: 'en', timeZone: 'Pacific/Auckland' } });
  const info = (await app.inject({ method: 'GET', url: '/api/info' })).json();
  assert.equal(info.timeZone, 'Pacific/Auckland');
  assert.equal(info.today, dayOf(new Date(), 'Pacific/Auckland'));
});

test('days: a late evening in Amsterdam is still that day, not the UTC one', () => {
  // 23:30 in Amsterdam on 31 March 2026 (summer time, UTC+2) is 21:30 UTC.
  assert.equal(dayOf('2026-03-31T21:30:00Z', 'Europe/Amsterdam'), '2026-03-31');
  // 00:30 in Amsterdam on 1 April is still 31 March in UTC.
  assert.equal(dayOf('2026-03-31T22:30:00Z', 'Europe/Amsterdam'), '2026-04-01');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30', 'calendar days across the DST switch');
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2);
});

test('export and import: an export round-trips, and an empty one wipes the data', async () => {
  const exported = (await app.inject({ method: 'GET', url: '/api/export/json' })).json();
  assert.equal(exported.app, 'open-nutrilog');
  assert.equal(exported.tables.profile.length, 1);

  assert.equal((await app.inject({ method: 'POST', url: '/api/import/json', payload: { app: 'open-nutrilog', tables: {} } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/profile' })).json().profile, null);

  assert.equal((await app.inject({ method: 'POST', url: '/api/import/json', payload: exported })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/profile' })).json().profile.timeZone, 'Pacific/Auckland');

  const foreign = await app.inject({ method: 'POST', url: '/api/import/json', payload: { app: 'open-strength', tables: {} } });
  assert.equal(foreign.statusCode, 400);
});
