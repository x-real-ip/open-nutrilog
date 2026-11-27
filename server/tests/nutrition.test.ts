// Pure functions: unit and serving conversions, totals, the OFF mapper and the throttle. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kcalFromMacros, quantityOf, scale, sumNutrients, type Nutrients } from '../../shared/nutrition.ts';
import { mapOff, normalizeBarcode } from '../services/off.ts';
import { RateLimiter } from '../services/throttle.ts';
import { queryWords } from '../services/products.ts';

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const bread: Nutrients = { kcal: 240, protein: 10, carbs: 40, sugars: 3, fat: 3, satFat: 0.5, fibre: 7, salt: 1.1 };
const slices = [
  { label: '1 slice', grams: 35 },
  { label: '1 loaf', grams: 800 },
];

test('units: grams and ml as given, servings through their weight, quick add has no quantity', () => {
  assert.equal(quantityOf(150, 'g', null, slices), 150);
  assert.equal(quantityOf(250, 'ml', null, []), 250);
  assert.equal(quantityOf(2, 'serving', '1 slice', slices), 70);
  assert.equal(quantityOf(0.5, 'serving', '1 loaf', slices), 400);
  assert.equal(quantityOf(1, 'serving', '1 bowl', slices), null, 'unknown serving');
  assert.equal(quantityOf(300, 'kcal', null, []), 0);
});

test('scale: per 100 g to an amount, unknown values stay unknown', () => {
  const two = scale(bread, 70);
  assert.equal(two.kcal, 168);
  assert.equal(two.protein, 7);
  assert.equal(two.carbs, 28);
  assert.equal(two.salt, 0.77);
  assert.equal(scale({ ...bread, fibre: null }, 50).fibre, null);
});

test('totals: unknown counts as zero, rounding to one decimal', () => {
  const total = sumNutrients([scale(bread, 70), scale({ ...bread, protein: null }, 35), { kcal: 300, protein: null, carbs: null, sugars: null, fat: null, satFat: null, fibre: null, salt: null }]);
  assert.equal(total.kcal, 168 + 84 + 300);
  assert.equal(total.protein, 7);
  assert.equal(total.carbs, 28 + 14);
  assert.equal(sumNutrients([]).kcal, 0);
});

test('kcal from macros (Atwater)', () => {
  assert.equal(kcalFromMacros({ protein: 10, carbs: 40, fat: 3, fibre: 7 }), 40 + 160 + 27 + 14);
});

test('OFF mapper: a full Dutch product', () => {
  const p = mapOff(fixture('off-yoghurt.json'))!;
  assert.equal(p.barcode, '8710400000017');
  assert.equal(p.nameNl, 'Volle yoghurt');
  assert.equal(p.nameEn, 'Volle yoghurt', 'no English name: the main name is used for both');
  assert.equal(p.brand, 'Testmerk', 'first brand only');
  assert.equal(p.unit, 'g');
  assert.deepEqual(p.per100, { kcal: 63, protein: 3.7, carbs: 4.6, sugars: 4.6, fat: 3.3, satFat: 2.2, fibre: 0, salt: 0.13 });
  assert.deepEqual(p.servings, [{ label: '150 g', grams: 150 }]);
  assert.deepEqual(p.extra.calcium, { value: 0.12, unit: 'mg' });
  assert.deepEqual(p.extra.sodium, { value: 0.052, unit: 'g' });
  assert.ok(!('nutrition-score-fr' in p.extra), 'scores are not nutrients');
});

test('OFF mapper: kJ only, sodium instead of salt, a drink in ml', () => {
  const p = mapOff(fixture('off-juice-kj-only.json'))!;
  assert.equal(p.per100.kcal, 44.9);
  assert.equal(p.per100.salt, 0.01);
  assert.equal(p.unit, 'ml');
  assert.equal(p.nameEn, 'Orange juice');
  assert.equal(p.nameNl, 'Orange juice');
  assert.equal(p.per100.fibre, null, 'missing is unknown, not zero');
  assert.deepEqual(p.servings, []);
});

test('OFF mapper: values only per serving are converted to per 100 g', () => {
  const p = mapOff(fixture('off-bar-per-serving.json'))!;
  assert.equal(p.per100.kcal, 400);
  assert.equal(p.per100.protein, 8);
  assert.equal(p.per100.carbs, 60);
  assert.equal(p.per100.fat, 14);
  assert.equal(p.per100.salt, 0.2);
  assert.equal(p.brand, '');
  assert.deepEqual(p.servings, [{ label: '1 barre (25 g)', grams: 25 }]);
});

test('OFF mapper: no energy value means not usable', () => {
  assert.equal(mapOff(fixture('off-no-energy.json')), null);
  assert.equal(mapOff(null), null);
});

test('barcodes: digits only, 8 to 14 long', () => {
  assert.equal(normalizeBarcode(' 8710400 000017 '), '8710400000017');
  assert.equal(normalizeBarcode('1234'), null);
  assert.equal(normalizeBarcode('123456789012345'), null);
});

test('search words: letters and digits only, so they are safe in a tsquery', () => {
  assert.deepEqual(queryWords("Volkoren brood & kaas:* 'x'"), ['volkoren', 'brood', 'kaas', 'x']);
  assert.deepEqual(queryWords('crème fraîche 30+'), ['crème', 'fraîche', '30']);
  assert.deepEqual(queryWords('  !!  '), []);
});

test('throttle: a full minute of tokens, then one every 60/n seconds', () => {
  let now = 0;
  const limiter = new RateLimiter(3, () => now);
  assert.ok(limiter.tryTake());
  assert.ok(limiter.tryTake());
  assert.ok(limiter.tryTake());
  assert.equal(limiter.tryTake(), false);
  assert.equal(limiter.waitMs(), 20_000);
  now += 20_000;
  assert.ok(limiter.tryTake());
  assert.equal(limiter.tryTake(), false);
  now += 10 * 60_000;
  assert.ok(limiter.tryTake() && limiter.tryTake() && limiter.tryTake(), 'refills up to the limit');
  assert.equal(limiter.tryTake(), false, 'never more than the limit');
});
