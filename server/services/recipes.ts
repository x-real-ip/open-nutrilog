// Recipes: a dish made of ingredients, with a weight after cooking and a number of portions. A recipe is stored as a
// product (source 'recipe') whose values per 100 g are worked out from its ingredients, and whose one serving is a
// portion. So you log it like any product: as portions or as grams. When an ingredient changes, the recipe is
// worked out again; what you already logged keeps its own values.
import { z } from 'zod';
import type { Recipe, RecipeIngredient } from '../../shared/types.ts';
import { NUTRIENT_KEYS, quantityOf, round, scale, type Nutrients, type Serving } from '../../shared/nutrition.ts';
import { all, getPool, one, run, tx, type Queryable } from '../db.ts';
import { loc, pick, UserError, type Lang } from '../i18n.ts';
import { getProduct, nutrientsOf, productName, setProductChangeHook } from './products.ts';

export const recipeSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    portions: z.number().positive().max(100),
    cookedWeightG: z.number().positive().max(50_000).nullable().default(null),
    ingredients: z
      .array(
        z
          .object({
            productId: z.number().int().positive(),
            amount: z.number().positive().max(10_000),
            unit: z.enum(['g', 'ml', 'serving']),
            servingLabel: z.string().max(60).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

const PORTION = loc('1 portion', '1 portie');

/** Totals of the ingredients. A nutrient is unknown only when no ingredient gives it. */
export function recipeTotals(parts: { per100: Nutrients; quantity: number }[]): Nutrients {
  const scaled = parts.map((p) => scale(p.per100, p.quantity));
  const out = {} as Record<string, number | null>;
  for (const k of NUTRIENT_KEYS) {
    const known = scaled.filter((n) => n[k] !== null);
    out[k] = known.length ? round(known.reduce((a, n) => a + (n[k] as number), 0), 2) : null;
  }
  return out as unknown as Nutrients;
}

/** Values per 100 g of the finished dish and per portion. The cooked weight (when given) replaces the raw weight. */
export function recipeValues(parts: { per100: Nutrients; quantity: number }[], portions: number, cookedWeightG: number | null) {
  const totals = recipeTotals(parts);
  const rawWeight = parts.reduce((a, p) => a + p.quantity, 0);
  const totalWeightG = cookedWeightG ?? rawWeight;
  // Kept at 3 decimals: a portion scaled back up from these values must match the portion itself.
  const f = totalWeightG > 0 ? 100 / totalWeightG : 0;
  const per100 = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, totals[k] === null ? null : round((totals[k] as number) * f, 3)])) as unknown as Nutrients;
  const perPortion = scale(totals, (1 / portions) * 100);
  return { totals, totalWeightG: round(totalWeightG, 1), per100, perPortion, portionGrams: round(totalWeightG / portions, 1) };
}

interface IngredientRow {
  product_id: number;
  amount: number;
  unit: 'g' | 'ml' | 'serving';
  serving_label: string | null;
  quantity: number;
}

/** The recipe's ingredients with the values of the product you see (its local edit, if there is one). */
async function ingredients(recipeId: number, db: Queryable): Promise<(IngredientRow & { p: any })[]> {
  const rows = await all(
    `SELECT i.product_id, i.amount, i.unit, i.serving_label, i.quantity, row_to_json(p) AS p
     FROM recipe_ingredients i
     JOIN products p ON p.id = coalesce((SELECT o.id FROM products o WHERE o.override_of = i.product_id), i.product_id)
     WHERE i.recipe_id = $1 ORDER BY i.position, i.id`,
    [recipeId],
    db,
  );
  return rows;
}

/** Works out a recipe's values again from its ingredients. */
async function recompute(recipeId: number, db: Queryable): Promise<void> {
  const meta = await one<{ recipe_portions: number; recipe_cooked_g: number | null; servings: Serving[] }>(
    'SELECT recipe_portions, recipe_cooked_g, servings FROM products WHERE id = $1',
    [recipeId],
    db,
  );
  if (!meta) return;
  const parts = (await ingredients(recipeId, db)).map((r) => ({ per100: nutrientsOf(r.p), quantity: r.quantity }));
  const v = recipeValues(parts, meta.recipe_portions, meta.recipe_cooked_g);
  const label = meta.servings?.[0]?.label ?? PORTION.en;
  const n = v.per100;
  await run(
    `UPDATE products SET kcal = $2, protein = $3, carbs = $4, sugars = $5, fat = $6, sat_fat = $7, fibre = $8, salt = $9, servings = $10, updated_at = now()
     WHERE id = $1`,
    [recipeId, n.kcal, n.protein, n.carbs, n.sugars, n.fat, n.satFat, n.fibre, n.salt, JSON.stringify([{ label, grams: v.portionGrams }])],
    db,
  );
}

/** After a product changed: every recipe that uses it (directly, as its local edit, or as its original) is worked out again. */
export async function recomputeUsing(productId: number, db: Queryable = getPool()): Promise<void> {
  const recipes = await all<{ recipe_id: number }>(
    `SELECT DISTINCT recipe_id FROM recipe_ingredients
     WHERE product_id = $1
        OR product_id = (SELECT override_of FROM products WHERE id = $1)
        OR product_id IN (SELECT id FROM products WHERE override_of = $1)`,
    [productId],
    db,
  );
  for (const r of recipes) await recompute(r.recipe_id, db);
}

setProductChangeHook((id) => recomputeUsing(id));

export async function getRecipe(id: number, lang: Lang): Promise<Recipe> {
  const product = await getProduct(id, lang);
  if (!product || product.source !== 'recipe') throw new UserError(404, 'Recipe not found', 'Recept niet gevonden');
  const meta = (await one<{ recipe_portions: number; recipe_cooked_g: number | null }>('SELECT recipe_portions, recipe_cooked_g FROM products WHERE id = $1', [id]))!;
  const rows = await ingredients(id, getPool());
  const list: RecipeIngredient[] = rows.map((r) => ({
    productId: r.product_id,
    name: productName(r.p.name_en, r.p.name_nl, lang),
    brand: r.p.brand,
    source: r.p.source,
    amount: r.amount,
    unit: r.unit,
    servingLabel: r.serving_label,
    quantity: r.quantity,
    kcal: round((r.p.kcal * r.quantity) / 100, 1),
  }));
  const v = recipeValues(
    rows.map((r) => ({ per100: nutrientsOf(r.p), quantity: r.quantity })),
    meta.recipe_portions,
    meta.recipe_cooked_g,
  );
  return { product, portions: meta.recipe_portions, cookedWeightG: meta.recipe_cooked_g, totalWeightG: v.totalWeightG, ingredients: list, perPortion: v.perPortion };
}

/** Creates (id null) or changes a recipe. */
export async function saveRecipe(id: number | null, raw: unknown, lang: Lang): Promise<Recipe> {
  const input = recipeSchema.parse(raw);
  const savedId = await tx(async (c) => {
    // Work out each ingredient's grams from the product it points at.
    const resolved: IngredientRow[] = [];
    for (const ing of input.ingredients) {
      const p = await getProduct(ing.productId, lang, c);
      if (!p) throw new UserError(400, 'An ingredient no longer exists.', 'Een ingrediënt bestaat niet meer.');
      if (p.source === 'recipe') throw new UserError(400, 'A recipe can’t be an ingredient of another recipe.', 'Een recept kan geen ingrediënt van een ander recept zijn.');
      const quantity = quantityOf(ing.amount, ing.unit, ing.servingLabel, p.servings);
      if (quantity === null) throw new UserError(400, `${p.name} has no such serving.`, `${p.name} heeft zo’n portie niet.`);
      resolved.push({ product_id: p.id, amount: ing.amount, unit: ing.unit, serving_label: ing.unit === 'serving' ? (ing.servingLabel ?? null) : null, quantity });
    }

    let recipeId = id;
    if (recipeId === null) {
      const row = await one<{ id: number }>(
        `INSERT INTO products (source, name_en, name_nl, unit, kcal, recipe_portions, recipe_cooked_g, servings)
         VALUES ('recipe', $1, $1, 'g', 0, $2, $3, $4) RETURNING id`,
        [input.name, input.portions, input.cookedWeightG, JSON.stringify([{ label: pick(PORTION, lang), grams: 1 }])],
        c,
      );
      recipeId = row!.id;
    } else {
      const n = await run(
        `UPDATE products SET name_en = $2, name_nl = $2, recipe_portions = $3, recipe_cooked_g = $4, updated_at = now() WHERE id = $1 AND source = 'recipe'`,
        [recipeId, input.name, input.portions, input.cookedWeightG],
        c,
      );
      if (!n) throw new UserError(404, 'Recipe not found', 'Recept niet gevonden');
      await run('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId], c);
    }
    for (const [i, r] of resolved.entries()) {
      await run(
        'INSERT INTO recipe_ingredients (recipe_id, position, product_id, amount, unit, serving_label, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [recipeId, i, r.product_id, r.amount, r.unit, r.serving_label, r.quantity],
        c,
      );
    }
    await recompute(recipeId, c);
    return recipeId;
  });
  return getRecipe(savedId, lang);
}
