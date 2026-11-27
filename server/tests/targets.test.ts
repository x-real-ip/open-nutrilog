// The target engine: pure functions, no database. The spec example must stay green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptiveTdee,
  bmr,
  dailyTarget,
  effectiveRate,
  ewma,
  phaseAdjustment,
  proteinPerKg,
  workoutEnergy,
  type Body,
  type DayIntake,
  type TargetSettings,
} from '../services/targets.ts';

const man: Body = { sex: 'male', age: 40, heightCm: 180, weightKg: 80 };
const cut: TargetSettings = { neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5, proteinGPerKg: null, carbCycling: true, metStrength: 5, workoutEnergyShare: 100 };

test('spec example: rest day 1982 kcal, training day 2222 kcal, protein 160 g', () => {
  const rest = dailyTarget(man, cut);
  assert.equal(rest.bmr, 1730);
  assert.equal(rest.base, 2422);
  assert.equal(rest.phaseAdjust, -440);
  assert.equal(rest.kcal, 1982);
  assert.equal(rest.proteinG, 160);
  assert.equal(rest.isTrainingDay, false);
  assert.equal(rest.floorHit, false);

  const training = dailyTarget(man, cut, { workout: { minutes: 45, source: 'finished' } });
  assert.equal(training.workoutKcal, 240);
  assert.equal(training.kcal, 2222);
  assert.equal(training.restKcal, 1982);
  assert.equal(training.proteinG, 160);
  assert.equal(training.carbsG - rest.carbsG, 60, 'the training energy goes to carbs');
  assert.equal(training.fatG, rest.fatG);
});

test('macros: protein per kg, fat at least 25 %, carbs the rest', () => {
  const t = dailyTarget(man, cut);
  assert.equal(t.fatG, Math.round((0.25 * 1982) / 9));
  assert.equal(t.carbsG, Math.round((1982 - 160 * 4 - t.fatG * 9) / 4));
  const kcalFromMacros = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
  assert.ok(Math.abs(kcalFromMacros - t.kcal) <= 6, 'macros add up to the target (rounding aside)');

  assert.equal(proteinPerKg({ phase: 'maintain', proteinGPerKg: null }), 1.8);
  assert.equal(proteinPerKg({ phase: 'bulk', proteinGPerKg: null }), 1.8);
  assert.equal(proteinPerKg({ phase: 'cut', proteinGPerKg: null }), 2.0);
  assert.equal(proteinPerKg({ phase: 'cut', proteinGPerKg: 1.6 }), 1.6, 'your own setting wins');
});

test('without carb cycling the training energy is shared over carbs and fat', () => {
  const t = dailyTarget(man, { ...cut, carbCycling: false }, { workout: { minutes: 45, source: 'finished' } });
  const rest = dailyTarget(man, cut);
  assert.equal(t.fatG - rest.fatG, Math.round((240 * 0.25) / 9));
  assert.equal(t.carbsG - rest.carbsG, Math.round((240 * 0.75) / 4));
});

test('BMR for a woman (−161 instead of +5)', () => {
  assert.equal(bmr({ sex: 'female', age: 30, heightCm: 165, weightKg: 60 }), 600 + 1031.25 - 150 - 161);
});

test('phase: maintain is zero, a bulk adds, rates are capped at 1 %/week (cut) and 0.5 %/week (bulk)', () => {
  assert.equal(phaseAdjustment('maintain', 0.5, 80), 0);
  assert.equal(Math.round(phaseAdjustment('bulk', 0.25, 80)), 220);
  assert.equal(effectiveRate('cut', 2), 1);
  assert.equal(effectiveRate('bulk', 1), 0.5);
  assert.equal(effectiveRate('cut', -1), 0);
  assert.equal(Math.round(phaseAdjustment('cut', 2, 80)), -880, 'a 2 %/week cut is treated as 1 %');
  const t = dailyTarget(man, { ...cut, ratePctPerWeek: 2 });
  assert.match(t.steps.find((s) => s.id === 'phase')!.text.en, /maximum/);
});

test('workout energy: net MET, capped at 120 minutes, and the share setting', () => {
  assert.equal(workoutEnergy(5, 80, 45, 100), 240);
  assert.equal(workoutEnergy(5, 80, 180, 100), workoutEnergy(5, 80, 120, 100), 'capped at two hours');
  assert.equal(workoutEnergy(5, 80, 45, 50), 120);
  assert.equal(workoutEnergy(5, 80, 45, 0), 0);
  assert.equal(workoutEnergy(0.5, 80, 45, 100), 0, 'never negative');
  const t = dailyTarget(man, { ...cut, workoutEnergyShare: 0 }, { workout: { minutes: 45, source: 'planned' } });
  assert.equal(t.kcal, 1982);
  assert.equal(t.isTrainingDay, true);
});

test('safety floor: the target never goes below the BMR, with an explanation', () => {
  const small: Body = { sex: 'female', age: 30, heightCm: 160, weightKg: 55 };
  const t = dailyTarget(small, { ...cut, neat: 1.2, ratePctPerWeek: 1 });
  assert.equal(t.floorHit, true);
  assert.equal(t.restKcal, t.bmr);
  assert.ok(t.steps.some((s) => s.id === 'floor'));
  assert.match(t.steps.find((s) => s.id === 'floor')!.text.nl, /ruststofwisseling/);
});

test('explanations exist in both languages with the language\'s decimals', () => {
  const t = dailyTarget({ ...man, weightKg: 80.5 }, cut, { workout: { minutes: 45, source: 'finished' } });
  for (const s of t.steps) {
    assert.ok(s.text.en && s.text.nl, s.id);
    assert.notEqual(s.text.en, s.text.nl, s.id);
  }
  assert.match(t.steps[0].text.en, /80\.5 kg/);
  assert.match(t.steps[0].text.nl, /80,5 kg/);
});

test('an adaptive base replaces the formula', () => {
  const t = dailyTarget(man, cut, { base: { kcal: 2600, source: 'adaptive' } });
  assert.equal(t.base, 2600);
  assert.equal(t.baseSource, 'adaptive');
  assert.equal(t.kcal, 2600 - 440);
});

// ---------- Adaptive TDEE ----------

function series(days: number, kcal: number, startKg: number, kgPerDay: number, opts: { weighEvery?: number; incomplete?: number[]; workoutKcal?: number } = {}) {
  const d0 = Date.parse('2026-10-01T00:00:00Z');
  const date = (i: number) => new Date(d0 + i * 86_400_000).toISOString().slice(0, 10);
  const intake: DayIntake[] = Array.from({ length: days }, (_, i) => ({
    date: date(i),
    kcal,
    incomplete: opts.incomplete?.includes(i) ?? false,
    workoutKcal: opts.workoutKcal ?? 0,
  }));
  const weights = Array.from({ length: days }, (_, i) => i)
    .filter((i) => i % (opts.weighEvery ?? 1) === 0)
    .map((i) => ({ date: date(i), kg: startKg + kgPerDay * i }));
  return { intake, weights };
}

test('EWMA: alpha 0.1 per weigh-in', () => {
  assert.deepEqual(ewma([80, 81, 79]).map((v) => Math.round(v * 1000) / 1000), [80, 80.1, 79.99]);
});

test('adaptive TDEE: not before 14 days, 10 logged days and 8 weigh-ins', () => {
  const short = series(10, 2500, 80, 0);
  const r = adaptiveTdee({ days: short.intake, weights: short.weights, formulaBase: 2422, previous: null });
  assert.equal(r.status, 'not_enough');
  assert.equal(r.base, 2422);
  assert.match(r.text.en, /14 days/);

  const fewWeighIns = series(28, 2500, 80, 0, { weighEvery: 5 });
  assert.equal(adaptiveTdee({ days: fewWeighIns.intake, weights: fewWeighIns.weights, formulaBase: 2422, previous: null }).status, 'not_enough');

  const incomplete = series(20, 2500, 80, 0, { incomplete: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.equal(adaptiveTdee({ days: incomplete.intake, weights: incomplete.weights, formulaBase: 2422, previous: null }).loggedDays, 9, 'incomplete days are left out');
});

test('adaptive TDEE: stable weight means intake is maintenance; it is blended by logged days', () => {
  const s = series(28, 2600, 80, 0);
  const r = adaptiveTdee({ days: s.intake, weights: s.weights, formulaBase: 2422, previous: null });
  assert.equal(r.status, 'ok');
  assert.equal(r.adaptiveBase, 2600);
  assert.equal(r.weight, 1);
  assert.equal(r.base, 2600);

  const half = series(14, 2600, 80, 0);
  const h = adaptiveTdee({ days: half.intake, weights: half.weights, formulaBase: 2422, previous: null });
  assert.equal(h.weight, 0.5);
  assert.equal(h.base, Math.round(2422 + 0.5 * (2600 - 2422)));
});

test('adaptive TDEE: losing weight on 2000 kcal means maintenance is higher', () => {
  // −0.07 kg/day for 28 days; the EWMA trend lags, so the estimate is conservative.
  const s = series(28, 2000, 82, -0.07);
  const r = adaptiveTdee({ days: s.intake, weights: s.weights, formulaBase: 2422, previous: null });
  assert.equal(r.status, 'ok');
  assert.ok(r.trendChangeKg! < 0);
  assert.ok(r.adaptiveBase! > 2000 && r.adaptiveBase! < 2000 + 0.07 * 7700 + 1, `${r.adaptiveBase}`);
});

test('adaptive TDEE: training energy is taken off, so it is maintenance without training', () => {
  const s = series(28, 2800, 80, 0, { workoutKcal: 200 });
  assert.equal(adaptiveTdee({ days: s.intake, weights: s.weights, formulaBase: 2422, previous: null }).base, 2600);
});

test('adaptive TDEE: moves at most 150 kcal a week from the previous estimate', () => {
  const s = series(28, 3200, 80, 0);
  const up = adaptiveTdee({ days: s.intake, weights: s.weights, formulaBase: 2422, previous: { base: 2500, weeksAgo: 1 } });
  assert.equal(up.base, 2650);
  assert.equal(up.clamped, true);
  const twoWeeks = adaptiveTdee({ days: s.intake, weights: s.weights, formulaBase: 2422, previous: { base: 2500, weeksAgo: 2 } });
  assert.equal(twoWeeks.base, 2800);
  const down = adaptiveTdee({ days: series(28, 1800, 80, 0).intake, weights: s.weights, formulaBase: 2422, previous: { base: 2500, weeksAgo: 1 } });
  assert.equal(down.base, 2350);
  assert.match(down.text.nl, /150 kcal per week/);
});
