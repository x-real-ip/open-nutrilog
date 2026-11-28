// The AI features against a local fake of the Anthropic Messages API: reading a meal from text and from a photo
// (matched to products, estimates only without a match), the coach (a suggestion only through the target engine),
// usage and the monthly budget.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { startTestDb } from './helpers.ts';

const requests: any[] = [];
let reply = '';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const sent = JSON.parse(body);
    requests.push({ url: req.url, body: sent });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: sent.model,
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2000, output_tokens: 400 },
      }),
    );
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

process.env.WEB_DIR = '/nonexistent';
const testDb = await startTestDb();
process.env.AI_PROVIDER = 'anthropic';
process.env.AI_API_KEY = 'test-key';
process.env.AI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.AI_MODEL = 'claude-haiku-5-5';

const { config } = await import('../config.ts');
const { openDb, closeDb, one } = await import('../db.ts');
const { initAuth } = await import('../auth.ts');
const { buildApp } = await import('../app.ts');
const { loadAiSettings } = await import('../services/aiSettings.ts');
const { splitSuggestion } = await import('../services/coach.ts');

await openDb(testDb.url);
await initAuth();
await loadAiSettings();
const app = await buildApp();
config.auth.mode = 'none';

after(async () => {
  await app.close();
  server.close();
  await closeDb();
  await testDb.stop();
});

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any });
  return { status: res.statusCode, body: res.json() };
};

const spec = { name: 'Spec', language: 'en', timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5, trainingMinutes: 45 };
const nevo = fs.readFileSync(new URL('./fixtures/nevo-synthetic.csv', import.meta.url));
const meal = (items: unknown[]) => '```json\n' + JSON.stringify({ items }) + '\n```';

beforeEach(async () => {
  requests.length = 0;
  await call('POST', '/api/import/json', { app: 'open-nutrilog', tables: {} });
  await call('PUT', '/api/settings/ai', { monthlyBudgetUsd: null, storePhotos: false });
  await call('PUT', '/api/profile', spec);
});

test('info says AI is on, with the model; the key never reaches the browser', async () => {
  const info = (await call('GET', '/api/info')).body;
  assert.equal(info.aiConfigured, true);
  assert.equal(info.aiModel, 'claude-haiku-5-5');
  const settings = (await call('GET', '/api/settings/ai')).body;
  assert.equal(settings.keyHint, '…-key');
  assert.ok(!JSON.stringify(settings).includes('test-key'));
  assert.equal(settings.parseEffort, 'low');
  assert.equal(settings.storePhotos, false);
});

test('meal from text: foods matched through the normal search; an estimate only where nothing matches', async () => {
  await app.inject({ method: 'POST', url: '/api/nevo/import?filename=NEVO2025_9.0.csv', payload: nevo, headers: { 'content-type': 'application/octet-stream' } });
  const bread = (await call('POST', '/api/products', { nameEn: 'Wholemeal bread', nameNl: 'Volkorenbrood', per100: { kcal: 240, protein: 10, carbs: 40, sugars: 3, fat: 3, satFat: 0.5, fibre: 7, salt: 1.1 } })).body.product;
  reply = meal([
    { name: 'wholemeal bread', grams: 70, estimate: { kcal: 170, protein: 7, carbs: 28, fat: 2 } },
    { name: 'test cheese', grams: 20, estimate: { kcal: 72, protein: 5, carbs: 0, fat: 6 } },
    { name: 'dragon fruit', grams: 150, estimate: { kcal: 90, protein: 2, carbs: 20, fat: 0 } },
  ]);
  const res = await call('POST', '/api/ai/meal/text', { text: '2 slices of wholemeal bread with cheese and a dragon fruit' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [l1, l2, l3] = res.body.lines;
  assert.equal(l1.candidates[0].id, bread.id, 'your own product first');
  assert.equal(l1.grams, 70);
  assert.equal(l2.candidates[0].source, 'nevo');
  assert.equal(l2.candidates[0].name, 'Test cheese matured');
  assert.deepEqual(l3.candidates, [], 'nothing matches');
  assert.deepEqual(l3.estimate, { kcal: 90, protein: 2, carbs: 20, fat: 0 });

  // What went to the AI: the user's text, a JSON-only system prompt in the profile language, low effort.
  const sent = requests[0].body;
  assert.equal(sent.messages[0].content, '2 slices of wholemeal bread with cheese and a dragon fruit');
  assert.match(sent.system, /in English/);
  assert.deepEqual(sent.output_config, { effort: 'low' });

  // Logging the unmatched line as an AI estimate marks the entry.
  const entry = (await call('PUT', `/api/diary/entries/${crypto.randomUUID()}`, { day: '2026-11-27', mealId: 1, productId: null, amount: 90, unit: 'kcal', quick: { name: 'dragon fruit', kcal: 90, protein: 2, carbs: 20, fat: 0, aiEstimate: true } })).body.entry;
  assert.equal(entry.aiEstimate, true);
  assert.equal((await call('GET', '/api/diary/2026-11-27')).body.entries[0].aiEstimate, true);
});

test('meal from text in Dutch, and a bad answer is reported, not guessed', async () => {
  await call('PUT', '/api/profile', { ...spec, language: 'nl' });
  reply = meal([]);
  await call('POST', '/api/ai/meal/text', { text: 'niks' });
  assert.match(requests[0].body.system, /in Dutch/);
  reply = 'I am not sure what you ate.';
  const bad = await call('POST', '/api/ai/meal/text', { text: 'iets' });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /onleesbaar|geen JSON|no JSON/i);
});

test('meal from a photo: the image goes to the AI; kept only when the setting says so', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  reply = meal([{ name: 'apple', grams: 150, estimate: { kcal: 78, protein: 0, carbs: 18, fat: 0 } }]);
  const res = await call('POST', '/api/ai/meal/photo', { image: `data:image/jpeg;base64,${jpeg}`, note: 'lunch' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const content = requests[0].body.messages[0].content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } });
  assert.deepEqual(content[1], { type: 'text', text: 'lunch' });
  assert.match(requests[0].body.system, /photo/);
  assert.equal((await one<{ n: number }>('SELECT count(*)::int AS n FROM meal_photos'))!.n, 0, 'not kept by default');

  await call('PUT', '/api/settings/ai', { storePhotos: true });
  await call('POST', '/api/ai/meal/photo', { image: `data:image/jpeg;base64,${jpeg}` });
  assert.equal((await one<{ n: number }>('SELECT count(*)::int AS n FROM meal_photos'))!.n, 1);

  assert.equal((await call('POST', '/api/ai/meal/photo', { image: 'data:text/html;base64,PGI+' })).status, 400);
});

test('nutrition label from a photo: values per 100 checked; kJ and sodium converted; no table is an error', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  const image = `data:image/jpeg;base64,${jpeg}`;
  reply = JSON.stringify({
    found: true,
    name: 'Granola bar',
    brand: 'Test',
    unit: 'g',
    per100: { kcal: 380, protein: 8.54, carbs: 62, sugars: 21, fat: 9.8, satFat: 4.1, fibre: null, salt: 0.4 },
    serving: { label: '1 bar', grams: 35 },
  });
  let res = await call('POST', '/api/ai/label', { image });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.label, {
    name: 'Granola bar',
    brand: 'Test',
    unit: 'g',
    per100: { kcal: 380, protein: 8.5, carbs: 62, sugars: 21, fat: 9.8, satFat: 4.1, fibre: null, salt: 0.4 },
    serving: { label: '1 bar', grams: 35 },
  });
  assert.equal(requests[0].body.messages[0].content[0].type, 'image');
  assert.match(requests[0].body.system, /nutrition labels/);
  assert.equal((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ai_usage WHERE feature = 'label'`))!.n, 1);

  // Only kJ and sodium, per 100 ml.
  reply = '```json\n' + JSON.stringify({ found: true, unit: 'ml', per100: { kj: 188, carbs: 10.2, sodium: 0.004 }, serving: null }) + '\n```';
  res = await call('POST', '/api/ai/label', { image });
  assert.deepEqual(res.body.label, {
    name: null,
    brand: null,
    unit: 'ml',
    per100: { kcal: 45, protein: null, carbs: 10.2, sugars: null, fat: null, satFat: null, fibre: null, salt: 0.01 },
    serving: null,
  });

  reply = JSON.stringify({ found: false });
  res = await call('POST', '/api/ai/label', { image });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /No nutrition table/);
  reply = JSON.stringify({ found: true, per100: { kcal: 5000 } });
  assert.equal((await call('POST', '/api/ai/label', { image })).status, 502, 'a value out of range is not taken');
  assert.equal((await call('POST', '/api/ai/label', { image: 'data:text/html;base64,PGI+' })).status, 400);
});

test('coach: real data in the prompt; a suggestion is split off and only previewed through the target engine', async () => {
  reply = 'You are doing fine, but a slower cut keeps your training strong.\nSUGGESTION {"phase":"cut","ratePctPerWeek":0.25}';
  const messages = (await call('POST', '/api/coach/messages', { content: 'Should I change anything?' })).body.messages;
  const answer = messages.at(-1);
  assert.equal(answer.content, 'You are doing fine, but a slower cut keeps your training strong.');
  assert.deepEqual(answer.suggestion, { phase: 'cut', ratePctPerWeek: 0.25 });
  const system = requests[0].body.system;
  assert.match(system, /Today's target: 1982 kcal/);
  assert.match(system, /You do not set targets/);
  assert.match(system, /BMR, Mifflin-St Jeor/);

  // The preview: worked out by the engine, nothing saved.
  const preview = (await call('POST', '/api/targets/preview', { phase: 'cut', ratePctPerWeek: 0.25 })).body;
  assert.equal(preview.target.kcal, 2422 - 220);
  assert.equal((await call('GET', '/api/profile')).body.profile.ratePctPerWeek, 0.5, 'not applied until you confirm');
  assert.equal((await call('POST', '/api/targets/preview', { phase: 'cut', ratePctPerWeek: 3 })).status, 400);

  // Clearing the chat.
  await call('DELETE', '/api/coach/messages');
  assert.deepEqual((await call('GET', '/api/coach/messages')).body.messages, []);
});

test('suggestion lines: only valid ones count', () => {
  assert.deepEqual(splitSuggestion('Fine.\nSUGGESTION {"phase":"bulk","ratePctPerWeek":0.25}').suggestion, { phase: 'bulk', ratePctPerWeek: 0.25 });
  assert.deepEqual(splitSuggestion('Fine.\nSUGGESTION {"phase":"maintain","ratePctPerWeek":0.5}').suggestion, { phase: 'maintain', ratePctPerWeek: 0 });
  assert.equal(splitSuggestion('Fine.\nSUGGESTION {"phase":"cut","ratePctPerWeek":5}').suggestion, null);
  assert.equal(splitSuggestion('Fine.\nSUGGESTION not json').suggestion, null);
  assert.equal(splitSuggestion('No change needed.').text, 'No change needed.');
});

test('usage per feature, and the monthly budget stops the AI', async () => {
  reply = meal([]);
  await call('POST', '/api/ai/meal/text', { text: 'water' });
  reply = 'Fine.';
  await call('POST', '/api/coach/messages', { content: 'Hi' });
  const usage = (await call('GET', '/api/usage')).body;
  const features = usage.byFeature.map((f: any) => f.feature).sort();
  assert.ok(features.includes('parse') && features.includes('coach'));
  assert.ok(usage.month.costUsd > 0, 'priced from the list');

  await call('PUT', '/api/settings/ai', { monthlyBudgetUsd: 0.000001 });
  const blocked = await call('POST', '/api/ai/meal/text', { text: 'water' });
  assert.equal(blocked.status, 503);
  assert.match(blocked.body.error, /monthly AI budget/);
});
