// The diary: what you ate per day and meal. Entries are written by an id the app makes (PUT), so the offline queue
// can retry without logging twice. Each entry keeps a snapshot of its nutrients and name: changing a product
// later doesn't rewrite what you ate.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DiaryDay, DiaryEntry, EntryInput } from '../../shared/types.ts';
import { quantityOf, scale, sumNutrients, type Nutrients } from '../../shared/nutrition.ts';
import { all, one, run, tx, type Queryable, getPool } from '../db.ts';
import { encode, loc, pick, UserError, type Lang } from '../i18n.ts';
import { DAY_PATTERN } from './days.ts';
import { listMeals } from './meals.ts';
import { getProduct, nutrientsOf } from './products.ts';

const day = z.string().regex(DAY_PATTERN);
const macro = z.number().min(0).max(1000).nullable().default(null);

export const entryInputSchema = z
  .object({
    day,
    mealId: z.number().int().positive(),
    productId: z.number().int().positive().nullable().default(null),
    amount: z.number().positive().max(10_000),
    unit: z.enum(['g', 'ml', 'serving', 'kcal']),
    servingLabel: z.string().max(60).nullable().optional(),
    quick: z
      .object({
        name: z.string().trim().max(80).default(''),
        kcal: z.number().min(0).max(10_000),
        protein: macro,
        carbs: macro,
        fat: macro,
        /** Values the AI estimated because no product matched; the diary marks them. */
        aiEstimate: z.boolean().default(false),
      })
      .nullable()
      .optional(),
  })
  .strict();

const QUICK_NAME = loc('Quick add', 'Snel toevoegen');

function toEntry(r: any, lang: Lang): DiaryEntry {
  return {
    id: r.id,
    day: r.day,
    mealId: r.meal_id,
    productId: r.product_id,
    name: pick(r.name, lang),
    brand: r.brand,
    source: r.source,
    amount: r.amount,
    unit: r.unit,
    servingLabel: r.serving_label,
    quantity: r.quantity,
    nutrients: nutrientsOf(r),
    aiEstimate: r.ai_estimate,
    createdAt: r.created_at,
  };
}

export async function getDay(d: string, lang: Lang): Promise<DiaryDay> {
  day.parse(d);
  const rows = await all('SELECT * FROM diary_entries WHERE day = $1 ORDER BY created_at, id', [d]);
  const entries = rows.map((r) => toEntry(r, lang));
  return { day: d, meals: await listMeals(lang), entries, totals: sumNutrients(entries.map((e) => e.nutrients)) };
}

interface Snapshot {
  productId: number | null;
  aiEstimate: boolean;
  name: string;
  brand: string;
  source: string | null;
  quantity: number;
  nutrients: Nutrients;
}

/** Works out name and nutrients for an entry from its product (or from the quick-add values). */
async function snapshot(input: EntryInput, existing: any | undefined, lang: Lang, db: Queryable): Promise<Snapshot> {
  if (input.unit === 'kcal') {
    const q = input.quick;
    if (!q) throw new UserError(400, 'A quick add needs an energy value.', 'Snel toevoegen heeft een energiewaarde nodig.');
    return {
      productId: null,
      aiEstimate: q.aiEstimate ?? false,
      name: q.name || encode(QUICK_NAME),
      brand: '',
      source: null,
      quantity: 0,
      nutrients: { kcal: q.kcal, protein: q.protein, carbs: q.carbs, fat: q.fat, sugars: null, satFat: null, fibre: null, salt: null },
    };
  }
  const product = input.productId ? await getProduct(input.productId, lang, db) : null;
  if (product) {
    const quantity = quantityOf(input.amount, input.unit, input.servingLabel, product.servings);
    if (quantity === null) throw new UserError(400, 'This product has no such serving.', 'Dit product heeft zo’n portie niet.');
    return {
      productId: product.id,
      aiEstimate: false,
      name: encode({ en: product.nameEn || product.nameNl, nl: product.nameNl || product.nameEn }),
      brand: product.brand,
      source: product.source,
      quantity,
      nutrients: scale(product.per100, quantity),
    };
  }
  if (existing && existing.unit !== 'kcal' && existing.quantity > 0) {
    // The product was deleted after this was logged: scale the entry's own values.
    const quantity = input.unit === 'serving' ? existing.quantity * (input.amount / existing.amount) : input.amount;
    const ratio = quantity / existing.quantity;
    return { productId: null, aiEstimate: existing.ai_estimate, name: existing.name, brand: existing.brand, source: existing.source, quantity, nutrients: scale(nutrientsOf(existing), ratio * 100) };
  }
  throw new UserError(400, 'Choose a product.', 'Kies een product.');
}

/** Logs or changes an entry. Sending the same id twice changes nothing. */
export async function putEntry(id: string, raw: unknown, lang: Lang): Promise<DiaryEntry> {
  if (!z.uuid().safeParse(id).success) throw new UserError(400, 'Invalid entry id', 'Ongeldige id');
  const input = entryInputSchema.parse(raw) as EntryInput;
  return tx(async (c) => {
    if (!(await one('SELECT 1 FROM meals WHERE id = $1', [input.mealId], c))) throw new UserError(400, 'Unknown meal', 'Onbekende maaltijd');
    const existing = await one('SELECT * FROM diary_entries WHERE id = $1 FOR UPDATE', [id], c);
    const snap = await snapshot(input, existing, lang, c);
    const n = snap.nutrients;
    const row = await one(
      `INSERT INTO diary_entries (id, day, meal_id, product_id, name, brand, source, amount, unit, serving_label, quantity,
         kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, ai_estimate, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now(), now())
       ON CONFLICT (id) DO UPDATE SET day = excluded.day, meal_id = excluded.meal_id, product_id = excluded.product_id, name = excluded.name,
         brand = excluded.brand, source = excluded.source, amount = excluded.amount, unit = excluded.unit, serving_label = excluded.serving_label,
         quantity = excluded.quantity, kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, sugars = excluded.sugars,
         fat = excluded.fat, sat_fat = excluded.sat_fat, fibre = excluded.fibre, salt = excluded.salt, ai_estimate = excluded.ai_estimate, updated_at = now()
       RETURNING *`,
      [
        id,
        input.day,
        input.mealId,
        snap.productId,
        snap.name,
        snap.brand,
        snap.source,
        input.amount,
        input.unit,
        input.unit === 'serving' ? (input.servingLabel ?? null) : null,
        snap.quantity,
        n.kcal,
        n.protein,
        n.carbs,
        n.sugars,
        n.fat,
        n.satFat,
        n.fibre,
        n.salt,
        snap.aiEstimate,
      ],
      c,
    );
    return toEntry(row, lang);
  });
}

/** Deleting an entry that is already gone is fine (the queue may send it twice). */
export async function deleteEntry(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  await run('DELETE FROM diary_entries WHERE id = $1', [id]);
}

export const copySchema = z
  .object({
    from: day,
    /** One day to copy to (kept for older clients); or `days` for several. */
    to: day.optional(),
    days: z.array(day).min(1).max(62).optional(),
    /** Copy only this meal; without it the whole day. */
    mealId: z.number().int().positive().nullable().default(null),
    /** Copy only these entries of `from`. */
    entryIds: z.array(z.uuid()).min(1).max(200).optional(),
    /** Into this meal; by default each entry keeps its own meal. */
    toMealId: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .refine((v) => v.to || v.days, { message: 'to or days is required' });

async function checkMeal(id: number | null, c: Queryable): Promise<void> {
  if (id !== null && !(await one('SELECT 1 FROM meals WHERE id = $1', [id], c))) throw new UserError(400, 'Unknown meal', 'Onbekende maaltijd');
}

/**
 * Copies entries (a whole day, one meal, or a selection) to one or more other days, as new entries with the same
 * values. Answers with the first day copied to.
 */
export async function copyEntries(raw: unknown, lang: Lang): Promise<DiaryDay & { copied: number }> {
  const { from, to, days, mealId, entryIds, toMealId } = copySchema.parse(raw);
  const targets = [...new Set(days ?? [to!])].sort();
  let copied = 0;
  await tx(async (c) => {
    await checkMeal(toMealId, c);
    const rows = await all(
      `SELECT * FROM diary_entries WHERE day = $1 AND ($2::int IS NULL OR meal_id = $2) AND ($3::uuid[] IS NULL OR id = ANY($3))
       ORDER BY created_at, id`,
      [from, mealId, entryIds ?? null],
      c,
    );
    if (!rows.length) throw new UserError(400, 'There is nothing to copy.', 'Er is niets om te kopiëren.');
    for (const target of targets) {
      for (const [i, r] of rows.entries()) {
        await run(
          `INSERT INTO diary_entries (id, day, meal_id, product_id, name, brand, source, amount, unit, serving_label, quantity,
             kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, ai_estimate, created_at, updated_at)
           SELECT $2, $3, $4, product_id, name, brand, source, amount, unit, serving_label, quantity,
             kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, ai_estimate, now() + $5 * interval '1 millisecond', now()
           FROM diary_entries WHERE id = $1`,
          [r.id, crypto.randomUUID(), target, toMealId ?? r.meal_id, i],
          c,
        );
        copied++;
      }
    }
  });
  return { ...(await getDay(targets[0], lang)), copied };
}

export const moveSchema = z
  .object({
    entryIds: z.array(z.uuid()).min(1).max(200),
    /** To this day; by default the day stays. */
    day: day.nullable().default(null),
    /** To this meal; by default each entry keeps its meal. */
    mealId: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .refine((v) => v.day || v.mealId, { message: 'day or mealId is required' });

/** Moves entries to another meal and/or day. Their values stay as they were logged. */
export async function moveEntries(raw: unknown): Promise<{ moved: number }> {
  const { entryIds, day: toDay, mealId } = moveSchema.parse(raw);
  return tx(async (c) => {
    await checkMeal(mealId, c);
    const rows = await all(
      `UPDATE diary_entries SET day = COALESCE($2::date, day), meal_id = COALESCE($3::int, meal_id), updated_at = now()
       WHERE id = ANY($1::uuid[]) RETURNING id`,
      [entryIds, toDay, mealId],
      c,
    );
    if (!rows.length) throw new UserError(400, 'There is nothing to move.', 'Er is niets om te verplaatsen.');
    return { moved: rows.length };
  });
}
