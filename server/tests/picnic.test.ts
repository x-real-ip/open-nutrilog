// Picnic, against a fake Picnic: linking with 2FA, recent delivered products, reading nutrition values from
// Picnic's text (several formats), drafts when there are none, and an expired login.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

const { config } = await import('../config.ts');
const { openDb, closeDb, run, one } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { parsePicnicNutrition, servingFrom, setPicnicApi, PicnicAuthError } = await import('../services/picnic.ts');

await openDb(testDb.url);
await initAuth();
const app = await buildApp();
config.auth.mode = 'none';

after(async () => {
  setPicnicApi(null);
  await app.close();
  await closeDb();
  await testDb.stop();
});

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any });
  return { status: res.statusCode, body: res.json(), raw: res.body };
};

// ---------- Reading Picnic's text ----------

test('nutrition: a markdown table with a per-100 column and a per-serving column', () => {
  const r = parsePicnicNutrition(`| Voedingswaarde | Per 100 g | Per portie (150 g) |
|---|---|---|
| Energie | 247 kJ (59 kcal) | 371 kJ (89 kcal) |
| Vetten | 0,2 g | 0,3 g |
| - Waarvan verzadigde vetzuren | 0,1 g | 0,2 g |
| Koolhydraten | 4,0 g | 6,0 g |
| - Waarvan suikers | 4,0 g | 6,0 g |
| Eiwitten | 10 g | 15 g |
| Zout | 0,1 g | 0,15 g |`)!;
  assert.deepEqual(r, { unit: 'g', per100: { kcal: 59, protein: 10, carbs: 4, sugars: 4, fat: 0.2, satFat: 0.1, fibre: null, salt: 0.1 } });
});

test('nutrition: plain lines, kJ only, sodium in mg, per 100 ml, traces', () => {
  const r = parsePicnicNutrition(`Voedingswaarde per 100 ml
Energie: 188 kJ
Vet: <0,5 g
Koolhydraten: 10,2 g
waarvan suikers: 9,8 g
Voedingsvezel: 0,4 g
Eiwit: 0,7 g
Natrium: 4 mg`)!;
  assert.equal(r.unit, 'ml');
  assert.equal(r.per100.kcal, 44.9);
  assert.equal(r.per100.fat, 0);
  assert.equal(r.per100.carbs, 10.2);
  assert.equal(r.per100.sugars, 9.8);
  assert.equal(r.per100.fibre, 0.4);
  assert.equal(r.per100.salt, 0.01);
  assert.equal(parsePicnicNutrition('Ingrediënten: melk, cultuur'), null, 'no energy, no values');
});

test('servings from the pack size', () => {
  assert.deepEqual(servingFrom('500 g'), { label: '500 g', grams: 500, unit: 'g' });
  assert.deepEqual(servingFrom('6 x 330 ml'), { label: '1 × 330 ml', grams: 330, unit: 'ml' });
  assert.deepEqual(servingFrom('1 liter'), { label: '1 liter', grams: 1000, unit: 'ml' });
  assert.equal(servingFrom('per stuk'), null);
});

// ---------- Linking and products, against a fake Picnic ----------

const calls: string[] = [];
let expired = false;
const pages: Record<string, { name: string; brand: string | null; unitQuantity: string; sections: { title: string; content: string }[] }> = {
  s100: { name: 'Magere kwark', brand: 'Picnic', unitQuantity: '500 g', sections: [{ title: 'Voedingswaarde', content: '| | Per 100 g |\n|---|---|\n| Energie | 239 kJ / 57 kcal |\n| Eiwitten | 9 g |\n| Koolhydraten | 4 g |\n| Vetten | 0,1 g |' }] },
  s200: { name: 'Bananen', brand: null, unitQuantity: '5 stuks', sections: [{ title: 'Ingrediënten', content: 'Banaan' }] },
};
const fake = {
  async login(email: string, password: string) {
    calls.push(`login ${email}`);
    if (password !== 'right') throw new Error('401 AUTH_INVALID');
    return { authKey: 'key-before-2fa', needs2fa: true };
  },
  async send2fa(key: string, channel: string) {
    calls.push(`send ${channel} ${key}`);
  },
  async verify2fa(key: string, code: string) {
    calls.push(`verify ${key}`);
    if (code !== '123456') throw new Error('wrong code');
    return 'key-after-2fa';
  },
  async deliveries(key: string) {
    calls.push(`deliveries ${key}`);
    if (expired) throw new PicnicAuthError('401');
    return [
      { id: 'd2', deliveredAt: '2026-11-26T17:00:00Z', articles: [{ id: 's100', name: 'Magere kwark', unitQuantity: '500 g' }, { id: 's200', name: 'Bananen', unitQuantity: '5 stuks' }] },
      { id: 'd1', deliveredAt: '2026-11-19T17:00:00Z', articles: [{ id: 's100', name: 'Magere kwark', unitQuantity: '500 g' }] },
    ];
  },
  async product(key: string, id: string) {
    calls.push(`product ${id} ${key}`);
    if (expired) throw new PicnicAuthError('401');
    return pages[id];
  },
};

beforeEach(async () => {
  setPicnicApi(fake);
  calls.length = 0;
  expired = false;
  await call('DELETE', '/api/picnic');
  await run(`DELETE FROM products WHERE source = 'picnic'`);
});

async function link() {
  await call('POST', '/api/picnic/login', { email: 'me@example.com', password: 'right' });
  await call('POST', '/api/picnic/2fa/send', { channel: 'SMS' });
  return call('POST', '/api/picnic/2fa/verify', { code: '123456' });
}

test('linking: a wrong password, then 2FA by SMS, a wrong code, the right code; only the key is kept', async () => {
  assert.deepEqual((await call('GET', '/api/picnic')).body, { linked: false, linkedAt: null, awaiting2fa: false });
  assert.equal((await call('POST', '/api/picnic/login', { email: 'me@example.com', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/picnic/2fa/verify', { code: '123456' })).status, 400, 'no login yet');

  const login = await call('POST', '/api/picnic/login', { email: 'me@example.com', password: 'right' });
  assert.deepEqual(login.body, { linked: false, linkedAt: null, awaiting2fa: true });
  await call('POST', '/api/picnic/2fa/send', { channel: 'SMS' });
  assert.ok(calls.includes('send SMS key-before-2fa'));
  assert.equal((await call('POST', '/api/picnic/2fa/verify', { code: '000000' })).status, 400);
  const linked = (await call('POST', '/api/picnic/2fa/verify', { code: '123456' })).body;
  assert.equal(linked.linked, true);
  assert.equal(linked.awaiting2fa, false);

  // The key stays on the server: not in any answer, and the password is nowhere.
  const stored = (await one<{ value: string }>(`SELECT value FROM settings WHERE key = 'picnic'`))!.value;
  assert.match(stored, /key-after-2fa/);
  assert.doesNotMatch(stored, /right|me@example/);
  for (const url of ['/api/picnic', '/api/info']) assert.doesNotMatch((await call('GET', url)).raw, /key-after-2fa/);
  assert.equal((await call('GET', '/api/info')).body.picnicLinked, true);
  // Nor in an export.
  assert.doesNotMatch((await call('GET', '/api/export/json')).raw, /key-after-2fa/);
});

test('recent products: from the last deliveries, most recent first, with how often', async () => {
  assert.equal((await call('GET', '/api/picnic/articles')).status, 400, 'not linked');
  await link();
  const { articles } = (await call('GET', '/api/picnic/articles')).body;
  assert.deepEqual(
    articles.map((a: any) => [a.id, a.times, a.productId]),
    [
      ['s100', 2, null],
      ['s200', 1, null],
    ],
  );
  assert.ok(calls.includes('deliveries key-after-2fa'));
});

test('reading a product: its values become a product (cached); without values you get a draft', async () => {
  await link();
  const r = (await call('POST', '/api/picnic/articles/s100/import')).body;
  assert.equal(r.draft, null);
  assert.equal(r.product.source, 'picnic');
  assert.equal(r.product.name, 'Magere kwark');
  assert.equal(r.product.brand, 'Picnic');
  assert.deepEqual(r.product.per100, { kcal: 57, protein: 9, carbs: 4, sugars: null, fat: 0.1, satFat: null, fibre: null, salt: null });
  assert.deepEqual(r.product.servings, [{ label: '500 g', grams: 500 }]);

  calls.length = 0;
  assert.equal((await call('POST', '/api/picnic/articles/s100/import')).body.product.id, r.product.id);
  assert.ok(!calls.some((c) => c.startsWith('product')), 'the second time comes from the database');
  assert.equal((await call('GET', '/api/products/search?q=magere%20kwark')).body.products[0].id, r.product.id, 'found by search');
  assert.equal((await call('GET', '/api/picnic/articles')).body.articles[0].productId, r.product.id);

  const draft = (await call('POST', '/api/picnic/articles/s200/import')).body;
  assert.equal(draft.product, null);
  assert.deepEqual(draft.draft, { name: 'Bananen', brand: '', unit: 'g', nutritionText: null });
  assert.equal((await call('POST', '/api/picnic/articles/bad%20id/import')).status, 400);
});

test('an expired login unlinks, with a clear message', async () => {
  await link();
  expired = true;
  const r = await call('GET', '/api/picnic/articles');
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Link your account again/);
  assert.equal((await call('GET', '/api/picnic')).body.linked, false);
});
