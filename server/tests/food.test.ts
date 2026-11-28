// Products, the OFF cache, meals and the diary, through the API against a real (embedded) Postgres.
// Open Food Facts is a local fake server, so the tests never go out to the internet.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
process.env.APP_VERSION = '9.9.9-test';
const testDb = await startTestDb();

// A fake Open Food Facts that knows one product and records the requests it gets.
const offRequests: { url: string; userAgent: string }[] = [];
let offMode: 'ok' | 'down' = 'ok';
const yoghurt = JSON.parse(fs.readFileSync(new URL('./fixtures/off-yoghurt.json', import.meta.url), 'utf8'));
const offServer = http.createServer((req, res) => {
  offRequests.push({ url: req.url ?? '', userAgent: String(req.headers['user-agent']) });
  if (offMode === 'down') {
    res.writeHead(500).end();
    return;
  }
  const code = /\/api\/v2\/product\/(\d+)/.exec(req.url ?? '')?.[1];
  res.setHeader('content-type', 'application/json');
  if (code === yoghurt.code) res.end(JSON.stringify({ status: 1, product: yoghurt }));
  else res.writeHead(404).end(JSON.stringify({ status: 0, status_verbose: 'product not found' }));
});
await new Promise<void>((r) => offServer.listen(0, '127.0.0.1', r));
process.env.OFF_BASE_URL = `http://127.0.0.1:${(offServer.address() as any).port}`;

const { config } = await import('../config.ts');
const { openDb, closeDb, run } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { clearBarcodeMisses } = await import('../services/products.ts');
const { productLimiter } = await import('../services/off.ts');

await openDb(testDb.url);
await initAuth();
const app = await buildApp();
config.auth.mode = 'none';

after(async () => {
  await app.close();
  offServer.close();
  await closeDb();
  await testDb.stop();
});

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any });
  return { status: res.statusCode, body: res.json() };
};

const DAY = '2026-11-27';
const per100 = (kcal: number, protein: number, carbs: number, fat: number) => ({ kcal, protein, carbs, fat, sugars: null, satFat: null, fibre: null, salt: null });

async function product(name: string, extra: Record<string, unknown> = {}) {
  const { status, body } = await call('POST', '/api/products', { nameEn: name, nameNl: '', per100: per100(240, 10, 40, 3), ...extra });
  assert.equal(status, 200, JSON.stringify(body));
  return body.product;
}

async function log(productId: number | null, input: Record<string, unknown> = {}, id: string = crypto.randomUUID()) {
  const { status, body } = await call('PUT', `/api/diary/entries/${id}`, { day: DAY, mealId: 1, productId, amount: 100, unit: 'g', ...input });
  assert.equal(status, 200, JSON.stringify(body));
  return body.entry;
}

beforeEach(async () => {
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
});

test('meals: four defaults in both languages, rename and hide, and they come back after an empty import', async () => {
  let meals = (await call('GET', '/api/meals')).body.meals;
  assert.deepEqual(meals.map((m: any) => m.name), ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  await call('PUT', '/api/profile', { language: 'nl' });
  meals = (await call('GET', '/api/meals')).body.meals;
  assert.deepEqual(meals.map((m: any) => m.name), ['Ontbijt', 'Lunch', 'Avondeten', 'Tussendoortjes']);

  // Hiding keeps the two-language name; renaming stores what you typed.
  meals = (await call('PUT', '/api/meals/4', { name: 'Tussendoortjes', hidden: true })).body.meals;
  await call('PUT', '/api/profile', { language: 'en' });
  meals = (await call('GET', '/api/meals')).body.meals;
  assert.equal(meals[3].name, 'Snacks');
  assert.equal(meals[3].hidden, true);
  meals = (await call('PUT', '/api/meals/1', { name: 'Ontbijtje' })).body.meals;
  assert.equal(meals[0].name, 'Ontbijtje');
  meals = (await call('POST', '/api/meals', { name: 'Pre-workout' })).body.meals;
  assert.equal(meals.at(-1).name, 'Pre-workout');
  assert.equal(meals.at(-1).position, 5);
});

test('own products: create with servings, validation, edit in place, delete keeps logged values', async () => {
  const bad = await call('POST', '/api/products', { nameEn: '', nameNl: '', per100: per100(100, 1, 1, 1) });
  assert.equal(bad.status, 400, 'a name is required');
  const twice = await call('POST', '/api/products', { nameEn: 'X', per100: per100(1, 1, 1, 1), servings: [{ label: 'a', grams: 1 }, { label: 'a', grams: 2 }] });
  assert.equal(twice.status, 400, 'serving names must differ');

  const bread = await product('Wholemeal bread', { nameNl: 'Volkorenbrood', barcode: '8710400099998', servings: [{ label: '1 slice', grams: 35 }] });
  assert.equal(bread.source, 'custom');
  assert.equal(bread.name, 'Wholemeal bread');
  const entry = await log(bread.id, { amount: 2, unit: 'serving', servingLabel: '1 slice' });
  assert.equal(entry.quantity, 70);
  assert.equal(entry.nutrients.kcal, 168);

  const edited = (await call('PUT', `/api/products/${bread.id}`, { nameEn: 'Wholemeal bread', nameNl: 'Volkorenbrood', per100: per100(250, 10, 40, 3), servings: [{ label: '1 slice', grams: 35 }] })).body.product;
  assert.equal(edited.id, bread.id, 'own products change in place');
  assert.equal(edited.per100.kcal, 250);
  let day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.entries[0].nutrients.kcal, 168, 'what you ate is a snapshot');

  assert.equal((await call('DELETE', `/api/products/${bread.id}`)).status, 200);
  day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.entries[0].nutrients.kcal, 168, 'deleting a product keeps the entry');
  assert.equal(day.entries[0].productId, null);
  // The queue may still send the old product id; the entry is then scaled from its own values.
  const again = await log(bread.id, { amount: 3, unit: 'serving', servingLabel: '1 slice' }, entry.id);
  assert.equal(again.nutrients.kcal, 252);
  assert.equal(again.name, 'Wholemeal bread');
});

test('diary: PUT is idempotent, edits move between meals and days, delete is idempotent, totals add up', async () => {
  const cheese = await product('Gouda', { per100: per100(356, 25, 0, 28) });
  const id = crypto.randomUUID();
  await log(cheese.id, { amount: 30 }, id);
  await log(cheese.id, { amount: 30 }, id);
  let day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.entries.length, 1, 'the same id twice logs once');
  assert.equal(day.totals.kcal, 106.8);
  assert.equal(day.totals.protein, 7.5);

  await log(cheese.id, { amount: 40, mealId: 2 }, id);
  day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.entries[0].mealId, 2);
  assert.equal(day.entries[0].nutrients.kcal, 142.4);

  // Quick add: energy and optional macros, no product.
  const quick = await log(null, { unit: 'kcal', amount: 250, quick: { name: '', kcal: 250, protein: 10, carbs: null, fat: null } });
  assert.equal(quick.name, 'Quick add');
  day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.totals.kcal, 392.4);
  assert.equal(day.totals.protein, 20);

  assert.equal((await call('DELETE', `/api/diary/entries/${id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/diary/entries/${id}`)).status, 200, 'deleting twice is fine');
  assert.equal((await call('GET', `/api/diary/${DAY}`)).body.entries.length, 1);

  // Bad input.
  assert.equal((await call('PUT', '/api/diary/entries/not-a-uuid', { day: DAY, mealId: 1, productId: cheese.id, amount: 1, unit: 'g' })).status, 400);
  assert.equal((await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 99, productId: cheese.id, amount: 1, unit: 'g' })).status, 400);
  assert.equal((await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 1, productId: cheese.id, amount: 1, unit: 'serving', servingLabel: 'x' })).status, 400);
  assert.equal((await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: '27-11-2026', mealId: 1, productId: cheese.id, amount: 1, unit: 'g' })).status, 400);
  assert.equal((await call('GET', '/api/diary/yesterday')).status, 400);
});

test('copy: a meal to another meal, a whole day to another day', async () => {
  const oats = await product('Oats', { per100: per100(370, 13, 60, 7) });
  await log(oats.id, { amount: 60, mealId: 1 });
  await log(oats.id, { amount: 40, mealId: 4 });

  let to = (await call('POST', '/api/diary/copy', { from: DAY, to: '2026-11-28', mealId: 1, toMealId: 2 })).body;
  assert.equal(to.entries.length, 1);
  assert.equal(to.entries[0].mealId, 2);
  assert.equal(to.entries[0].nutrients.kcal, 222);

  to = (await call('POST', '/api/diary/copy', { from: DAY, to: '2026-11-28' })).body;
  assert.equal(to.entries.length, 3);
  assert.equal(to.totals.kcal, 222 * 2 + 148);
  assert.equal((await call('GET', `/api/diary/${DAY}`)).body.entries.length, 2, 'the source day is unchanged');

  const empty = await call('POST', '/api/diary/copy', { from: '2026-01-01', to: DAY });
  assert.equal(empty.status, 400);
});

test('copy: selected entries to several days, into their own meal or another one', async () => {
  const oats = await product('Oats', { per100: per100(370, 13, 60, 7) });
  const a = await log(oats.id, { amount: 60, mealId: 1 });
  await log(oats.id, { amount: 40, mealId: 4 });
  const b = await log(oats.id, { amount: 20, mealId: 4 });
  const days = ['2026-11-30', '2026-11-28', '2026-11-29', '2026-11-28'];

  const r = (await call('POST', '/api/diary/copy', { from: DAY, days, entryIds: [a.id, b.id] })).body;
  assert.equal(r.copied, 6, 'two entries, three distinct days');
  assert.equal(r.day, '2026-11-28', 'answers with the first day');
  for (const d of ['2026-11-28', '2026-11-29', '2026-11-30']) {
    const got = (await call('GET', `/api/diary/${d}`)).body.entries;
    assert.deepEqual(
      got.map((e: any) => [e.mealId, e.amount, e.nutrients.kcal]),
      [
        [1, 60, 222],
        [4, 20, 74],
      ],
    );
    assert.ok(!got.some((e: any) => e.id === a.id || e.id === b.id), 'new ids');
  }

  // A whole meal into another meal on a later day.
  await call('POST', '/api/diary/copy', { from: DAY, days: ['2026-12-01'], mealId: 4, toMealId: 3 });
  assert.deepEqual(
    (await call('GET', '/api/diary/2026-12-01')).body.entries.map((e: any) => [e.mealId, e.amount]),
    [
      [3, 40],
      [3, 20],
    ],
  );

  // Bad input.
  assert.equal((await call('POST', '/api/diary/copy', { from: DAY })).status, 400, 'no target day');
  assert.equal((await call('POST', '/api/diary/copy', { from: DAY, days: ['2026-12-02'], toMealId: 99 })).status, 400, 'unknown meal');
  assert.equal((await call('POST', '/api/diary/copy', { from: DAY, days: ['2026-12-02'], entryIds: [crypto.randomUUID()] })).status, 400, 'nothing to copy');
  const many = Array.from({ length: 63 }, (_, i) => `2027-01-${String((i % 28) + 1).padStart(2, '0')}`);
  assert.equal((await call('POST', '/api/diary/copy', { from: DAY, days: many })).status, 400, 'at most 62 days');
});

test('move: entries to another meal and day, values unchanged even after the product changed', async () => {
  const oats = await product('Oats', { per100: per100(370, 13, 60, 7) });
  const a = await log(oats.id, { amount: 60, mealId: 1 });
  const b = await log(oats.id, { amount: 40, mealId: 1 });
  const c = await log(oats.id, { amount: 10, mealId: 2 });
  await call('PUT', `/api/products/${oats.id}`, { nameEn: 'Oats', nameNl: '', per100: per100(500, 13, 60, 7) });

  assert.deepEqual((await call('POST', '/api/diary/move', { entryIds: [a.id, c.id], mealId: 4 })).body, { moved: 2 });
  let entries = (await call('GET', `/api/diary/${DAY}`)).body.entries;
  assert.deepEqual(
    entries.map((e: any) => [e.id, e.mealId, e.nutrients.kcal]),
    [
      [a.id, 4, 222],
      [b.id, 1, 148],
      [c.id, 4, 37],
    ],
  );

  await call('POST', '/api/diary/move', { entryIds: [b.id], day: '2026-11-26', mealId: 3 });
  entries = (await call('GET', '/api/diary/2026-11-26')).body.entries;
  assert.deepEqual(
    entries.map((e: any) => [e.id, e.mealId, e.nutrients.kcal]),
    [[b.id, 3, 148]],
  );
  assert.equal((await call('GET', `/api/diary/${DAY}`)).body.entries.length, 2);

  assert.equal((await call('POST', '/api/diary/move', { entryIds: [a.id] })).status, 400, 'nowhere to go');
  assert.equal((await call('POST', '/api/diary/move', { entryIds: [a.id], mealId: 99 })).status, 400, 'unknown meal');
  assert.equal((await call('POST', '/api/diary/move', { entryIds: [crypto.randomUUID()], mealId: 2 })).status, 400, 'nothing to move');
  assert.equal((await call('POST', '/api/diary/move', { entryIds: ['nope'], mealId: 2 })).status, 400);
});

test('search: prefixes and typos, own and recently eaten first, hidden left out', async () => {
  const offId = (await call('GET', `/api/products/barcode/${yoghurt.code}`)).body.product.id;
  const own = await product('Greek yoghurt');
  await product('Volkoren brood', { nameNl: 'Volkoren brood' });

  let found = (await call('GET', '/api/products/search?q=yogh')).body.products;
  assert.deepEqual(found.map((p: any) => p.id), [own.id, offId], 'own products before OFF');

  // Eating the OFF one makes it "yours" too; more uses rank higher.
  await log(offId);
  await log(offId);
  await log(own.id);
  found = (await call('GET', '/api/products/search?q=yoghurt')).body.products;
  assert.deepEqual(found.map((p: any) => p.id), [offId, own.id]);

  assert.equal((await call('GET', '/api/products/search?q=volk%20bro')).body.products[0].name, 'Volkoren brood', 'prefix of every word');
  assert.equal((await call('GET', '/api/products/search?q=yoghrt')).body.products.length, 2, 'a typo still finds it');
  assert.equal((await call('GET', '/api/products/search?q=testmerk')).body.products[0].id, offId, 'brand is searched');
  assert.deepEqual((await call('GET', '/api/products/search?q=%20%20')).body.products, []);

  await call('PUT', `/api/products/${own.id}/preference`, { preference: 'hidden' });
  found = (await call('GET', '/api/products/search?q=yoghurt')).body.products;
  assert.deepEqual(found.map((p: any) => p.id), [offId]);
  const lists = (await call('GET', '/api/products/lists')).body;
  assert.deepEqual(lists.hidden.map((p: any) => p.id), [own.id]);
  assert.ok(!lists.recent.some((p: any) => p.id === own.id), 'hidden is not offered in recent');
});

test('lists: recent, frequent, favourites and your own products', async () => {
  const a = await product('Apple');
  const b = await product('Banana');
  await log(a.id);
  await log(b.id);
  await log(a.id);
  await call('PUT', `/api/products/${b.id}/preference`, { preference: 'favorite' });
  const lists = (await call('GET', '/api/products/lists')).body;
  assert.deepEqual(lists.recent.map((p: any) => p.name), ['Apple', 'Banana']);
  assert.deepEqual(lists.frequent.map((p: any) => p.name), ['Apple'], 'frequent means more than once');
  assert.deepEqual(lists.favorites.map((p: any) => p.name), ['Banana']);
  assert.equal(lists.favorites[0].preference, 'favorite');
  assert.deepEqual(lists.mine.map((p: any) => p.name), ['Apple', 'Banana']);
  await call('PUT', `/api/products/${b.id}/preference`, { preference: null });
  assert.deepEqual((await call('GET', '/api/products/lists')).body.favorites, []);
});

test('barcode: OFF lookup with our User-Agent and only the fields we need, then from the cache', async () => {
  offRequests.length = 0;
  clearBarcodeMisses();
  const first = await call('GET', `/api/products/barcode/${yoghurt.code}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.product.source, 'off');
  assert.equal(first.body.product.name, 'Volle yoghurt');
  assert.equal(offRequests.length, 1);
  assert.equal(offRequests[0].userAgent, 'open-nutrilog/9.9.9-test (+https://github.com/x-real-ip/open-nutrilog)');
  assert.match(offRequests[0].url, /fields=code,lang,product_name/);

  assert.equal((await call('GET', `/api/products/barcode/${yoghurt.code}`)).status, 200);
  assert.equal(offRequests.length, 1, 'the second lookup comes from Postgres');

  // Stale: fetched again; when OFF is down, the cached copy is used.
  await run(`UPDATE products SET fetched_at = now() - interval '40 days' WHERE source = 'off'`);
  offMode = 'down';
  const stale = await call('GET', `/api/products/barcode/${yoghurt.code}`);
  offMode = 'ok';
  assert.equal(stale.status, 200);
  assert.equal(offRequests.length, 2);
  await call('GET', `/api/products/barcode/${yoghurt.code}`);
  assert.equal(offRequests.length, 3, 'still stale after a failed refresh, so it tries again');
  await call('GET', `/api/products/barcode/${yoghurt.code}`);
  assert.equal(offRequests.length, 3, 'fresh again');
});

test('barcode: unknown, invalid, unreachable and throttled', async () => {
  offRequests.length = 0;
  clearBarcodeMisses();
  const unknown = await call('GET', '/api/products/barcode/8710400000055');
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /add it yourself/);
  assert.equal((await call('GET', '/api/products/barcode/8710400000055')).status, 404);
  assert.equal(offRequests.length, 1, 'a miss is remembered');

  assert.equal((await call('GET', '/api/products/barcode/123')).status, 400);

  offMode = 'down';
  const down = await call('GET', '/api/products/barcode/8710400000062');
  offMode = 'ok';
  assert.equal(down.status, 502);

  const saved = productLimiter.tryTake;
  productLimiter.tryTake = () => false;
  const throttled = await call('GET', '/api/products/barcode/8710400000079');
  productLimiter.tryTake = saved;
  assert.equal(throttled.status, 429);
  assert.equal(offRequests.length, 2, 'a throttled lookup never reaches OFF');
});

test('barcode: your own product with the same barcode wins; editing an OFF product makes a local edit', async () => {
  clearBarcodeMisses();
  const off = (await call('GET', `/api/products/barcode/${yoghurt.code}`)).body.product;
  await call('PUT', `/api/products/${off.id}/preference`, { preference: 'favorite' });
  await log(off.id, { amount: 150 });

  const edit = (await call('PUT', `/api/products/${off.id}`, { nameEn: 'Yoghurt (mine)', nameNl: 'Yoghurt (eigen)', barcode: yoghurt.code, per100: per100(70, 4, 5, 3.5) })).body.product;
  assert.notEqual(edit.id, off.id);
  assert.equal(edit.overrideOf, off.id);
  assert.equal(edit.source, 'custom');
  assert.equal(edit.preference, 'favorite', 'the mark follows the edit');
  const original = (await call('GET', `/api/products/${off.id}`)).body.product;
  assert.equal(original.per100.kcal, 63, 'the OFF row is never edited');

  assert.equal((await call('GET', `/api/products/barcode/${yoghurt.code}`)).body.product.id, edit.id);
  assert.deepEqual((await call('GET', '/api/products/search?q=yoghurt')).body.products.map((p: any) => p.id), [edit.id], 'the edit stands in for the original');
  const recent = (await call('GET', '/api/products/lists')).body.recent;
  assert.deepEqual(recent.map((p: any) => p.id), [edit.id], 'also for what you ate before the edit');

  // Editing again updates the same local edit.
  const again = (await call('PUT', `/api/products/${off.id}`, { nameEn: 'Yoghurt (mine)', barcode: yoghurt.code, per100: per100(72, 4, 5, 3.5) })).body.product;
  assert.equal(again.id, edit.id);

  assert.equal((await call('DELETE', `/api/products/${off.id}`)).status, 400, 'database products cannot be deleted');
  await call('DELETE', `/api/products/${edit.id}`);
  const back = (await call('GET', `/api/products/barcode/${yoghurt.code}`)).body.product;
  assert.equal(back.id, off.id, 'deleting the edit brings back the original');
  assert.equal(back.preference, 'favorite');
});

test('export and import keep products, edits, marks, meals and entries', async () => {
  clearBarcodeMisses();
  const off = (await call('GET', `/api/products/barcode/${yoghurt.code}`)).body.product;
  const edit = (await call('PUT', `/api/products/${off.id}`, { nameEn: 'Mine', per100: per100(70, 4, 5, 3.5) })).body.product;
  await call('PUT', `/api/products/${edit.id}/preference`, { preference: 'favorite' });
  await call('POST', '/api/meals', { name: 'Late snack' });
  await log(edit.id);

  const exported = (await call('GET', '/api/export/json')).body;
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  assert.equal((await call('GET', `/api/diary/${DAY}`)).body.entries.length, 0);
  assert.equal((await call('POST', '/api/import/json', exported)).status, 200);

  const day = (await call('GET', `/api/diary/${DAY}`)).body;
  assert.equal(day.entries.length, 1);
  assert.equal(day.meals.at(-1).name, 'Late snack');
  assert.equal((await call('GET', '/api/products/lists')).body.favorites[0].id, edit.id);
  // Sequences carry on after the imported ids.
  const next = await product('After import');
  assert.ok(next.id > edit.id);
});
