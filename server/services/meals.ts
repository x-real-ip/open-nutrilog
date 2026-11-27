// Meals of a day: breakfast, lunch, dinner and snacks by default; you can rename, hide and add them.
// Default names are stored in both languages; a name you type is stored as you typed it.
import { z } from 'zod';
import type { Meal } from '../../shared/types.ts';
import { all, one, run, type Queryable, getPool } from '../db.ts';
import { encode, loc, pick, UserError, type Lang } from '../i18n.ts';

export const DEFAULT_MEALS = [loc('Breakfast', 'Ontbijt'), loc('Lunch', 'Lunch'), loc('Dinner', 'Avondeten'), loc('Snacks', 'Tussendoortjes')];

export async function listMeals(lang: Lang, db: Queryable = getPool()): Promise<Meal[]> {
  const rows = await all<{ id: number; name: string; position: number; hidden: boolean }>('SELECT * FROM meals ORDER BY position, id', [], db);
  return rows.map((r) => ({ id: r.id, name: pick(r.name, lang), position: r.position, hidden: r.hidden }));
}

/** After an import without meals (or an empty one) the day needs its meals back. */
export async function ensureMeals(db: Queryable = getPool()): Promise<void> {
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM meals', [], db))!.n;
  if (n > 0) return;
  for (const [i, name] of DEFAULT_MEALS.entries()) {
    await run('INSERT INTO meals (id, name, position) VALUES ($1, $2, $3)', [i + 1, encode(name), i + 1], db);
  }
  await run(`SELECT setval(pg_get_serial_sequence('meals', 'id'), (SELECT max(id) FROM meals))`, [], db);
}

const mealInput = z.object({ name: z.string().trim().min(1).max(40), hidden: z.boolean().default(false) }).strict();

export async function addMeal(raw: unknown, lang: Lang): Promise<Meal[]> {
  const { name } = mealInput.parse(raw);
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM meals'))!.n;
  if (n >= 10) throw new UserError(400, 'You can have at most 10 meals.', 'Je kunt maximaal 10 maaltijden hebben.');
  await run('INSERT INTO meals (name, position) VALUES ($1, (SELECT coalesce(max(position), 0) + 1 FROM meals))', [name]);
  return listMeals(lang);
}

export async function updateMeal(id: number, raw: unknown, lang: Lang): Promise<Meal[]> {
  const input = mealInput.parse(raw);
  const current = await one<{ name: string }>('SELECT name FROM meals WHERE id = $1', [id]);
  if (!current) throw new UserError(404, 'Meal not found', 'Maaltijd niet gevonden');
  // Keep the stored two-language name when only "hidden" changed, so a default name keeps following the language.
  const name = pick(current.name, lang) === input.name ? current.name : input.name;
  await run('UPDATE meals SET name = $2, hidden = $3 WHERE id = $1', [id, name, input.hidden]);
  return listMeals(lang);
}
