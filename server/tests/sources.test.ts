// Phase 4 through the API: NEVO import (CSV and zip, synthetic data only), the OFF dump import, the live OFF
// search, ranking across sources, recipes, attributions, and exports that leave NEVO out.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { startTestDb } from './helpers.ts';

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();

// A fake Open Food Facts: the search API and a dump download.
const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const yoghurt = JSON.parse(fixture('off-yoghurt.json').toString());
let searchCalls = 0;
let lastSearch: URLSearchParams | null = null;
const DUMP_HEADER = ['code', 'url', 'product_name', 'brands', 'quantity', 'countries_tags', 'serving_size', 'serving_quantity', 'energy-kcal_100g', 'energy_100g', 'fat_100g', 'carbohydrates_100g', 'sugars_100g', 'proteins_100g', 'salt_100g', 'sodium_100g'];
const dumpRows = [
  ['8710400000111', 'x', 'Appelstroop', 'Stroopfabriek', '450 g', 'en:netherlands', '15 g', '15', '270', '', '0', '65', '50', '1', '0.1', ''],
  ['5400000000222', 'x', 'Speculoos', 'Koekjes', '250 g', 'en:belgium,en:france', '', '', '480', '', '19', '71', '37', '5', '1', ''],
  ['3000000000333', 'x', 'Pain de mie', 'Boulangerie', '500 g', 'en:france', '', '', '260', '', '4', '49', '5', '8', '1.2', ''],
  ['8710400000444', 'x', 'No energy (en:netherlands)', 'X', '', 'en:netherlands', '', '', '', '', '1', '1', '', '1', '', ''],
  ['8710400000555', 'x', 'Karnemelk', 'Zuivel', '1 l', 'en:germany', '', '', '', '160', '0.5', '4', '4', '3.5', '', '0.05'],
  ['8710400000666', 'x', 'Karnemelk', 'Zuivel', '1 l', 'en:netherlands', '', '', '', '160', '0.5', '4', '4', '3.5', '', '0.05'],
];
const dumpText = [DUMP_HEADER, ...dumpRows].map((r) => r.join('\t')).join('\n') + '\n';
const offServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/search') {
    searchCalls++;
    lastSearch = url.searchParams;
    res.setHeader('content-type', 'application/json');
    // search-a-licious: hits, brands as tags.
    res.end(JSON.stringify({ hits: [{ ...yoghurt, brands: ['xx:test-merk'] }, { code: '1234', product_name: 'Bad barcode', nutriments: { 'energy-kcal_100g': 1 } }, { code: '8710400000999', product_name: 'No energy' }] }));
  } else if (url.pathname === '/dump.csv.gz') {
    res.end(zlib.gzipSync(dumpText));
  } else res.writeHead(404).end();
});
await new Promise<void>((r) => offServer.listen(0, '127.0.0.1', r));
const offBase = `http://127.0.0.1:${(offServer.address() as any).port}`;
process.env.OFF_BASE_URL = offBase;
process.env.OFF_SEARCH_URL = `${offBase}/search`;

const { config } = await import('../config.ts');
const { openDb, closeDb } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { parseNevoFile, versionFromName, nevoNumber } = await import('../services/nevo.ts');
const { importOffDump } = await import('../services/offDump.ts');
const { searchLimiter } = await import('../services/off.ts');
const { recipeValues } = await import('../services/recipes.ts');

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
const uploadNevo = (body: Buffer, filename = 'NEVO2025_9.0.csv', extra = '') =>
  app.inject({ method: 'POST', url: `/api/nevo/import?filename=${encodeURIComponent(filename)}${extra}`, payload: body, headers: { 'content-type': 'application/octet-stream' } });

const nevoCsv = fixture('nevo-synthetic.csv');
const DAY = '2026-11-27';

/** A minimal zip writer for the tests (stored and deflated entries). */
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const crc = zlib.crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

beforeEach(async () => {
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
});

// ---------- NEVO ----------

test('NEVO parser: codes, names in both languages, comma decimals, salt from sodium, the rest kept', () => {
  const { foods, version } = parseNevoFile(nevoCsv, 'NEVO2025_9.0.csv');
  assert.equal(version, '2025/9.0');
  assert.equal(foods.length, 5);
  const bread = foods.find((f) => f.code === '9003')!;
  assert.equal(bread.nameNl, 'Testbrood volkoren');
  assert.equal(bread.nameEn, 'Test wholemeal bread');
  assert.deepEqual(bread.per100, { kcal: 238, protein: 10.5, carbs: 39, sugars: 2.8, fat: 3.3, satFat: 0.6, fibre: 7.1, salt: 1.125 });
  assert.deepEqual(bread.extra.K, { value: 230, unit: 'mg' });
  assert.deepEqual(bread.extra.WATER, { value: 38, unit: 'g' });
  assert.equal(foods.find((f) => f.code === '9002')!.per100.salt, 0, '"<1" is a trace');
  assert.equal(foods.find((f) => f.code === '9002')!.extra.VITC, undefined, 'empty is unknown');
});

test('NEVO parser: other delimiters and decimal points, a zip, versions, and refusing other files', () => {
  const semicolon = Buffer.from(nevoCsv.toString().replaceAll('|', ';').replace(/(\d),(\d)/g, '$1.$2'));
  const a = parseNevoFile(semicolon, 'export.csv');
  assert.equal(a.foods.length, 5);
  assert.equal(a.version, null);
  assert.equal(a.foods[0].per100.protein, 0.3);

  const zip = makeZip([
    { name: 'Gebruiksvoorwaarden.txt', data: Buffer.from('Conditions') },
    { name: 'NEVO2025_9.0/NEVO2025_9.0.csv', data: nevoCsv, deflate: true },
    { name: 'NEVO2025_details.csv', data: Buffer.from('NEVO-code|Iets\n9001|x\n') },
  ]);
  const z = parseNevoFile(zip, 'download.zip');
  assert.equal(z.foods.length, 5);
  assert.equal(z.version, '2025/9.0', 'the version from the file inside');

  assert.equal(versionFromName('NEVO-online 2023 v8.0.csv'), '2023/8.0');
  assert.equal(versionFromName('foods.csv'), null);
  assert.equal(nevoNumber(' 1,25 '), 1.25);
  assert.equal(nevoNumber('-'), null);
  assert.throws(() => parseNevoFile(Buffer.from('a,b,c\n1,2,3\n'), 'x.csv'), /not a NEVO file/);
});

test('NEVO import: via the app, searchable in both languages, ranked between your own products and OFF', async () => {
  const res = await uploadNevo(nevoCsv);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual({ ...res.json().nevo, importedAt: undefined }, { version: '2025/9.0', count: 5, importedAt: undefined });

  // An OFF product and your own one with "test" in the name.
  await call('GET', `/api/products/search?q=yoghurt&online=1`);
  await call('POST', '/api/products', { nameEn: 'Test pie', per100: { kcal: 300, protein: 4, carbs: 40, sugars: 20, fat: 14, satFat: 6, fibre: 1, salt: 0.3 } });

  let found = (await call('GET', '/api/products/search?q=test')).body.products;
  assert.equal(found[0].source, 'custom', 'your own first');
  assert.ok(found.slice(1, 6).every((p: any) => p.source === 'nevo'), 'then NEVO');
  assert.equal(found.at(-1).source, 'off', 'then OFF');

  await call('PUT', '/api/profile', { language: 'nl' });
  found = (await call('GET', '/api/products/search?q=appel')).body.products;
  assert.equal(found[0].name, 'Testappel');
  assert.equal(found[0].sourceVersion, '2025/9.0');
  await call('PUT', '/api/profile', { language: 'en' });
  assert.equal((await call('GET', '/api/products/search?q=apple')).body.products[0].name, 'Test apple');

  const sources = (await call('GET', '/api/sources')).body;
  assert.equal(sources.nevo.attribution, 'Based on data from NEVO-online version 2025/9.0, RIVM, Bilthoven.');
  await call('PUT', '/api/profile', { language: 'nl' });
  assert.equal((await call('GET', '/api/sources')).body.nevo.attribution, 'Gebaseerd op gegevens uit NEVO-online versie 2025/9.0, RIVM, Bilthoven.');

  assert.equal((await uploadNevo(Buffer.from('nonsense'), 'x.csv')).statusCode, 400);
});

test('NEVO: rows stay as they are; an edit is an override; a new version updates and removes', async () => {
  await uploadNevo(nevoCsv);
  const apple = (await call('GET', '/api/products/search?q=testappel')).body.products[0];
  assert.equal((await call('DELETE', `/api/products/${apple.id}`)).status, 400, 'NEVO rows cannot be deleted');
  const edit = (await call('PUT', `/api/products/${apple.id}`, { nameEn: 'My apple', nameNl: 'Mijn appel', per100: { ...apple.per100, kcal: 60 } })).body.product;
  assert.equal(edit.overrideOf, apple.id);
  assert.equal((await call('GET', `/api/products/${apple.id}`)).body.product.per100.kcal, 52, 'the NEVO row is unchanged');

  // Version 9.1 without the tea: updated values, the tea is gone, the override stays.
  const next = Buffer.from(nevoCsv.toString().split('\n').filter((l) => !l.includes('9005')).join('\n').replace('|52|', '|53|'));
  const res = (await uploadNevo(next, 'NEVO2026_9.1.csv')).json();
  assert.equal(res.nevo.version, '2026/9.1');
  assert.equal(res.nevo.count, 4);
  assert.equal((await call('GET', `/api/products/${apple.id}`)).body.product.per100.kcal, 53);
  assert.deepEqual((await call('GET', '/api/products/search?q=testthee')).body.products, []);
  assert.equal((await call('GET', `/api/products/${edit.id}`)).body.product.per100.kcal, 60);

  // A version given by hand wins.
  assert.equal((await uploadNevo(nevoCsv, 'nevo.csv', '&version=2025/9.0')).json().nevo.version, '2025/9.0');
});

test('export leaves NEVO out; import keeps NEVO and points entries, marks, edits and recipes at it by code', async () => {
  await uploadNevo(nevoCsv);
  const [apple, rice] = await Promise.all(['testappel', 'testrijst'].map(async (q) => (await call('GET', `/api/products/search?q=${q}`)).body.products[0]));
  await call('PUT', `/api/products/${apple.id}/preference`, { preference: 'favorite' });
  await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 1, productId: apple.id, amount: 150, unit: 'g' });
  const edit = (await call('PUT', `/api/products/${rice.id}`, { nameEn: 'Rice (mine)', per100: { ...rice.per100, kcal: 140 } })).body.product;
  const recipe = (await call('POST', '/api/recipes', { name: 'Apple rice', portions: 2, cookedWeightG: null, ingredients: [{ productId: apple.id, amount: 200, unit: 'g' }, { productId: edit.id, amount: 100, unit: 'g' }] })).body.recipe;

  const exported = (await call('GET', '/api/export/json')).body;
  assert.ok(!exported.tables.products.some((p: any) => p.source === 'nevo'), 'no NEVO data in the export');
  assert.equal(exported.nevoRefs.length, 5, 'only the codes');
  assert.ok(!JSON.stringify(exported).includes('Testbrood'), 'not even a NEVO name');

  // Import into an app that has NEVO (with other ids, as after a fresh NEVO import).
  await call('POST', '/api/import/json', exported);
  const entry = (await call('GET', `/api/diary/${DAY}`)).body.entries[0];
  const appleNow = (await call('GET', '/api/products/search?q=testappel')).body.products[0];
  assert.equal(entry.productId, appleNow.id);
  assert.equal(appleNow.preference, 'favorite');
  const riceEdit = (await call('GET', '/api/products/search?q=rice%20mine')).body.products[0];
  const original = (await call('GET', `/api/products/${riceEdit.overrideOf}`)).body.product;
  assert.equal(original.source, 'nevo', 'the edit points at the NEVO rice here');
  assert.equal(original.nameEn, 'Test rice boiled');
  const r = (await call('GET', `/api/recipes/${recipe.product.id}`)).body.recipe;
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.ingredients[0].name, 'Test apple');
});

test('import without NEVO: references become empty, logged values stay', async () => {
  await uploadNevo(nevoCsv);
  const apple = (await call('GET', '/api/products/search?q=testappel')).body.products[0];
  await call('PUT', `/api/products/${apple.id}/preference`, { preference: 'favorite' });
  await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 1, productId: apple.id, amount: 150, unit: 'g' });
  const exported = (await call('GET', '/api/export/json')).body;
  exported.nevoRefs = exported.nevoRefs.map((r: any) => ({ ...r, code: `x${r.code}` })); // codes this app doesn't know
  assert.equal((await call('POST', '/api/import/json', exported)).status, 200);
  const entry = (await call('GET', `/api/diary/${DAY}`)).body.entries[0];
  assert.equal(entry.productId, null);
  assert.equal(entry.nutrients.kcal, 78);
  assert.deepEqual((await call('GET', '/api/products/lists')).body.favorites, []);
});

// ---------- Open Food Facts: the dump and the live search ----------

test('OFF dump: only NL/BE products with energy, from a file or a download, idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'off-dump-'));
  const file = path.join(dir, 'dump.csv.gz');
  fs.writeFileSync(file, zlib.gzipSync(dumpText));
  const r = await importOffDump({ file, batchSize: 2 });
  assert.deepEqual(r, { scanned: 6, matched: 4, imported: 3 }, 'the one without energy is matched but not usable');
  const names = (await call('GET', '/api/products/search?q=appelstroop')).body.products;
  assert.equal(names[0].source, 'off');
  assert.equal(names[0].brand, 'Stroopfabriek');
  assert.deepEqual(names[0].servings, [{ label: '15 g', grams: 15 }]);
  assert.equal((await call('GET', '/api/products/search?q=speculoos')).body.products.length, 1, 'Belgium counts');
  assert.deepEqual((await call('GET', '/api/products/search?q=pain%20de%20mie')).body.products, [], 'France does not');
  const milk = (await call('GET', '/api/products/search?q=karnemelk')).body.products;
  assert.equal(milk.length, 1, 'only the Dutch one');
  assert.equal(milk[0].unit, 'ml');
  assert.equal(milk[0].per100.kcal, 38.2, 'from kJ');
  assert.equal(milk[0].per100.salt, 0.125, 'from sodium');

  // From the (fake) download, again: same products, refreshed.
  const again = await importOffDump({ url: `${offBase}/dump.csv.gz` });
  assert.equal(again.imported, 3);
  const sources = (await call('GET', '/api/sources')).body;
  assert.equal(sources.off.products, 3);
  assert.equal(sources.off.lastImport.imported, 3);
  fs.rmSync(dir, { recursive: true, force: true });

  await assert.rejects(importOffDump({ url: `${offBase}/missing.csv.gz` }), /HTTP 404/);
});

test('OFF dump never touches your own products or local edits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'off-dump-'));
  const file = path.join(dir, 'dump.csv');
  fs.writeFileSync(file, dumpText);
  await importOffDump({ file });
  const off = (await call('GET', '/api/products/search?q=appelstroop')).body.products[0];
  const edit = (await call('PUT', `/api/products/${off.id}`, { nameEn: 'My syrup', barcode: off.barcode, per100: { ...off.per100, kcal: 999 } })).body.product;
  await importOffDump({ file });
  assert.equal((await call('GET', `/api/products/${edit.id}`)).body.product.per100.kcal, 999);
  assert.equal((await call('GET', `/api/products/barcode/${off.barcode}`)).body.product.id, edit.id);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('live OFF search: only when asked, cached, unusable results left out, throttled', async () => {
  searchCalls = 0;
  assert.deepEqual((await call('GET', '/api/products/search?q=yoghurt')).body.products, [], 'the local search never asks OFF');
  assert.equal(searchCalls, 0);
  const online = (await call('GET', '/api/products/search?q=yoghurt&online=1')).body.products;
  assert.equal(searchCalls, 1);
  assert.deepEqual(online.map((p: any) => p.name), ['Volle yoghurt']);
  assert.equal(online[0].brand, 'Test Merk', 'a brand tag becomes a name');
  assert.equal(lastSearch?.get('q'), 'yoghurt');
  assert.equal(lastSearch?.get('langs'), 'nl,en');
  assert.equal((await call('GET', '/api/products/search?q=yoghurt')).body.products.length, 1, 'now cached locally');

  const saved = searchLimiter.tryTake;
  searchLimiter.tryTake = () => false;
  assert.equal((await call('GET', '/api/products/search?q=kaas&online=1')).status, 429);
  searchLimiter.tryTake = saved;
});

// ---------- Recipes ----------

test('recipe values: cooked weight, portions, unknown only when no ingredient knows it', () => {
  const v = recipeValues(
    [
      { per100: { kcal: 131, protein: 2.7, carbs: 28, sugars: null, fat: 0.3, satFat: null, fibre: 0.4, salt: 0 }, quantity: 300 },
      { per100: { kcal: 165, protein: 31, carbs: 0, sugars: 0, fat: 3.6, satFat: 1, fibre: null, salt: 0.2 }, quantity: 200 },
    ],
    2,
    450,
  );
  assert.equal(v.totals.kcal, 393 + 330);
  assert.equal(v.totals.sugars, 0, 'one ingredient knows it');
  assert.equal(v.totalWeightG, 450);
  assert.equal(v.per100.kcal, 160.667);
  assert.equal(v.perPortion.kcal, 361.5);
  assert.equal(v.portionGrams, 225);
  assert.equal(recipeValues([{ per100: { kcal: 100, protein: null, carbs: null, sugars: null, fat: null, satFat: null, fibre: null, salt: null }, quantity: 200 }], 4, null).totalWeightG, 200, 'without a cooked weight: the raw weight');
});

test('recipes: create, log as portions or grams, follow ingredient changes, guard deletes', async () => {
  await uploadNevo(nevoCsv);
  const rice = (await call('GET', '/api/products/search?q=testrijst')).body.products[0];
  const chicken = (await call('POST', '/api/products', { nameEn: 'Chicken', per100: { kcal: 165, protein: 31, carbs: 0, sugars: 0, fat: 3.6, satFat: 1, fibre: null, salt: 0.2 }, servings: [{ label: 'fillet', grams: 100 }] })).body.product;

  const bad = await call('POST', '/api/recipes', { name: 'X', portions: 2, cookedWeightG: null, ingredients: [] });
  assert.equal(bad.status, 400);
  const created = await call('POST', '/api/recipes', {
    name: 'Rice with chicken',
    portions: 2,
    cookedWeightG: 450,
    ingredients: [
      { productId: rice.id, amount: 300, unit: 'g' },
      { productId: chicken.id, amount: 2, unit: 'serving', servingLabel: 'fillet' },
    ],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const recipe = created.body.recipe;
  assert.equal(recipe.product.source, 'recipe');
  assert.equal(recipe.totalWeightG, 450);
  assert.equal(recipe.perPortion.kcal, 361.5);
  assert.deepEqual(recipe.product.servings, [{ label: '1 portion', grams: 225 }]);
  assert.equal(recipe.ingredients[1].quantity, 200);

  // It is a product: found by search, logged as a portion or in grams.
  const found = (await call('GET', '/api/products/search?q=rice%20with')).body.products[0];
  assert.equal(found.id, recipe.product.id);
  assert.equal(found.source, 'recipe');
  assert.equal(found.portions, 2);
  const portion = (await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 3, productId: recipe.product.id, amount: 1, unit: 'serving', servingLabel: '1 portion' })).body.entry;
  assert.equal(portion.nutrients.kcal, 361.5);
  assert.equal(portion.quantity, 225);
  const grams = (await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 3, productId: recipe.product.id, amount: 300, unit: 'g' })).body.entry;
  assert.equal(grams.nutrients.kcal, 482);

  // Changing an ingredient updates the recipe (not what was logged).
  await call('PUT', `/api/products/${chicken.id}`, { nameEn: 'Chicken', per100: { kcal: 200, protein: 31, carbs: 0, sugars: 0, fat: 8, satFat: 2, fibre: null, salt: 0.2 }, servings: [{ label: 'fillet', grams: 100 }] });
  assert.equal((await call('GET', `/api/recipes/${recipe.product.id}`)).body.recipe.perPortion.kcal, 396.5);
  assert.equal((await call('GET', `/api/diary/${DAY}`)).body.entries[0].nutrients.kcal, 361.5);
  // A local edit of the NEVO rice counts too.
  await call('PUT', `/api/products/${rice.id}`, { nameEn: 'Rice', per100: { ...rice.per100, kcal: 141 } });
  assert.equal((await call('GET', `/api/recipes/${recipe.product.id}`)).body.recipe.perPortion.kcal, 411.5);

  // Guards.
  assert.equal((await call('DELETE', `/api/products/${chicken.id}`)).status, 409, 'used in a recipe');
  assert.equal((await call('PUT', `/api/products/${recipe.product.id}`, { nameEn: 'X', per100: { kcal: 1, protein: null, carbs: null, sugars: null, fat: null, satFat: null, fibre: null, salt: null } })).status, 400);
  const nested = await call('POST', '/api/recipes', { name: 'Nested', portions: 1, cookedWeightG: null, ingredients: [{ productId: recipe.product.id, amount: 100, unit: 'g' }] });
  assert.equal(nested.status, 400);

  // Edit the recipe itself: three portions, no cooked weight.
  const changed = (await call('PUT', `/api/recipes/${recipe.product.id}`, { name: 'Rice with chicken', portions: 3, cookedWeightG: null, ingredients: [{ productId: rice.id, amount: 300, unit: 'g' }] })).body.recipe;
  assert.equal(changed.ingredients.length, 1);
  assert.equal(changed.totalWeightG, 300);
  assert.deepEqual(changed.product.servings, [{ label: '1 portion', grams: 100 }], 'the portion keeps its name');
  assert.equal((await call('DELETE', `/api/products/${chicken.id}`)).status, 200, 'no longer used');
  assert.equal((await call('DELETE', `/api/products/${recipe.product.id}`)).status, 200);
  assert.equal((await call('GET', `/api/recipes/${recipe.product.id}`)).status, 404);
});

test('diary CSV: every entry with English meal names and plain numbers', async () => {
  await call('PUT', '/api/profile', { language: 'nl' });
  await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: DAY, mealId: 2, productId: null, amount: 250, unit: 'kcal', quick: { name: 'Soep, "zelfgemaakt"', kcal: 250, protein: 10.5, carbs: null, fat: null } });
  const res = await app.inject({ method: 'GET', url: '/api/export/diary.csv' });
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  const [header, line] = res.body.trim().split('\n');
  assert.match(header, /^date,meal,food,brand,source,amount,unit/);
  assert.equal(line, `${DAY},Lunch,"Soep, ""zelfgemaakt""",,quick,250,kcal,,0,250,10.5,,,,,,,false`);
});
