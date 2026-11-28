// Saved meals: a fixed set of foods ("my breakfast") that is logged in one tap. Made from diary entries; each item
// keeps a snapshot like an entry. Listing works the values out from the product as it is now, so logging a saved
// meal gives what logging each food again would give; an item whose product was deleted becomes a quick add with
// its own values.
import { z } from 'zod';
import type { SavedMeal, SavedMealItem } from '../../shared/types.ts';
import { quantityOf, scale, sumNutrients } from '../../shared/nutrition.ts';
import { all, one, run, tx, getPool, type Queryable } from '../db.ts';
import { pick, UserError, type Lang } from '../i18n.ts';
import { getProduct, nutrientsOf } from './products.ts';

const MAX_MEALS = 100;
const MAX_ITEMS = 40;

async function toItem(r: any, lang: Lang, db: Queryable): Promise<SavedMealItem> {
  const own = nutrientsOf(r);
  const product = r.product_id && r.unit !== 'kcal' ? await getProduct(r.product_id, lang, db) : null;
  if (product) {
    // A serving that no longer exists is logged as the grams it was.
    let quantity = quantityOf(r.amount, r.unit, r.serving_label, product.servings);
    const byGrams = quantity === null;
    if (byGrams) quantity = r.quantity;
    return {
      id: r.id,
      productId: product.id,
      amount: byGrams ? r.quantity : r.amount,
      unit: byGrams ? product.unit : r.unit,
      servingLabel: byGrams ? null : r.serving_label,
      quick: null,
      name: product.name,
      brand: product.brand,
      source: product.source,
      quantity: quantity!,
      nutrients: scale(product.per100, quantity!),
      aiEstimate: false,
    };
  }
  const name = pick(r.name, lang).slice(0, 80);
  return {
    id: r.id,
    productId: null,
    amount: Math.max(own.kcal, 0.1),
    unit: 'kcal',
    servingLabel: null,
    quick: { name, kcal: own.kcal, protein: own.protein, carbs: own.carbs, fat: own.fat, aiEstimate: r.ai_estimate },
    name,
    brand: r.brand,
    source: null,
    quantity: 0,
    nutrients: { ...own, sugars: null, satFat: null, fibre: null, salt: null },
    aiEstimate: r.ai_estimate,
  };
}

export async function listSavedMeals(lang: Lang, db: Queryable = getPool()): Promise<SavedMeal[]> {
  const meals = await all<{ id: number; name: string }>('SELECT id, name FROM saved_meals ORDER BY lower(name), id', [], db);
  const rows = await all('SELECT * FROM saved_meal_items ORDER BY saved_meal_id, position, id', [], db);
  const out: SavedMeal[] = [];
  for (const m of meals) {
    const items: SavedMealItem[] = [];
    for (const r of rows.filter((x) => x.saved_meal_id === m.id)) items.push(await toItem(r, lang, db));
    out.push({ id: m.id, name: m.name, items, totals: sumNutrients(items.map((i) => i.nutrients)) });
  }
  return out;
}

const name = z.string().trim().min(1).max(60);

export const createSchema = z.object({ name, entryIds: z.array(z.uuid()).min(1).max(MAX_ITEMS) }).strict();

/** A new saved meal from diary entries (in the order they were logged). */
export async function createSavedMeal(raw: unknown, lang: Lang): Promise<{ savedMeal: SavedMeal }> {
  const input = createSchema.parse(raw);
  const id = await tx(async (c) => {
    const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM saved_meals', [], c))!.n;
    if (n >= MAX_MEALS) throw new UserError(400, `You can have at most ${MAX_MEALS} saved meals.`, `Je kunt maximaal ${MAX_MEALS} vaste maaltijden hebben.`);
    const entries = await all('SELECT * FROM diary_entries WHERE id = ANY($1::uuid[]) ORDER BY created_at, id', [input.entryIds], c);
    if (!entries.length) throw new UserError(400, 'There is nothing to save.', 'Er is niets om op te slaan.');
    const { id } = (await one<{ id: number }>('INSERT INTO saved_meals (name) VALUES ($1) RETURNING id', [input.name], c))!;
    for (const [i, e] of entries.entries()) {
      await run(
        `INSERT INTO saved_meal_items (saved_meal_id, position, product_id, name, brand, source, amount, unit, serving_label, quantity,
           kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, ai_estimate)
         SELECT $1, $2, product_id, name, brand, source, amount, unit, serving_label, quantity,
           kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, ai_estimate
         FROM diary_entries WHERE id = $3`,
        [id, i + 1, e.id],
        c,
      );
    }
    return id;
  });
  return { savedMeal: (await listSavedMeals(lang)).find((m) => m.id === id)! };
}

export const updateSchema = z.object({ name, itemIds: z.array(z.number().int().positive()).min(1).max(MAX_ITEMS).optional() }).strict();

/** Renames a saved meal, and keeps only the given items when `itemIds` is sent. */
export async function updateSavedMeal(id: number, raw: unknown, lang: Lang): Promise<{ savedMeal: SavedMeal }> {
  const input = updateSchema.parse(raw);
  await tx(async (c) => {
    if (!(await one('SELECT 1 FROM saved_meals WHERE id = $1 FOR UPDATE', [id], c))) throw new UserError(404, 'Saved meal not found', 'Vaste maaltijd niet gevonden');
    await run('UPDATE saved_meals SET name = $2 WHERE id = $1', [id, input.name], c);
    if (input.itemIds) {
      const kept = await all('SELECT id FROM saved_meal_items WHERE saved_meal_id = $1 AND id = ANY($2::int[])', [id, input.itemIds], c);
      if (!kept.length) throw new UserError(400, 'A saved meal needs at least one food.', 'Een vaste maaltijd heeft minstens één product nodig.');
      await run('DELETE FROM saved_meal_items WHERE saved_meal_id = $1 AND NOT (id = ANY($2::int[]))', [id, input.itemIds], c);
    }
  });
  return { savedMeal: (await listSavedMeals(lang)).find((m) => m.id === id)! };
}

export async function deleteSavedMeal(id: number): Promise<void> {
  await run('DELETE FROM saved_meals WHERE id = $1', [id]);
}
