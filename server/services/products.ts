// Products: your own, Open Food Facts (cached), and later NEVO. All live in one table with a `source`.
// A local edit of an OFF/NEVO product is an override row that points at it; the source row stays as it came.
import { z } from 'zod';
import type { Product, ProductInput, ProductLists, ProductPreference } from '../../shared/types.ts';
import type { Nutrients } from '../../shared/nutrition.ts';
import { config } from '../config.ts';
import { all, one, run, tx, type Queryable, getPool } from '../db.ts';
import { UserError, type Lang } from '../i18n.ts';
import { addDays } from './days.ts';
import { fetchOffProduct, normalizeBarcode, type OffProduct } from './off.ts';

const COLUMNS = `p.id, p.source, p.source_id, p.barcode, p.name_en, p.name_nl, p.brand, p.unit, p.kcal, p.protein, p.carbs, p.sugars,
  p.fat, p.sat_fat, p.fibre, p.salt, p.extra, p.servings, p.override_of, p.source_version, p.fetched_at, pp.preference`;

const FROM = 'products p LEFT JOIN product_prefs pp ON pp.product_id = p.id';

/** An original that has a local edit is shown as that edit. */
const NOT_OVERRIDDEN = 'NOT EXISTS (SELECT 1 FROM products o WHERE o.override_of = p.id)';

export function nutrientsOf(r: any): Nutrients {
  return { kcal: r.kcal, protein: r.protein, carbs: r.carbs, sugars: r.sugars, fat: r.fat, satFat: r.sat_fat, fibre: r.fibre, salt: r.salt };
}

export function productName(nameEn: string, nameNl: string, lang: Lang): string {
  return lang === 'nl' ? nameNl || nameEn : nameEn || nameNl;
}

function toProduct(r: any, lang: Lang): Product {
  return {
    id: r.id,
    source: r.source,
    name: productName(r.name_en, r.name_nl, lang),
    nameEn: r.name_en,
    nameNl: r.name_nl,
    brand: r.brand,
    barcode: r.barcode,
    unit: r.unit,
    per100: nutrientsOf(r),
    extra: r.extra ?? {},
    servings: r.servings ?? [],
    preference: r.preference ?? null,
    overrideOf: r.override_of,
    sourceVersion: r.source_version ?? (r.fetched_at ? String(r.fetched_at).slice(0, 10) : null),
  };
}

export async function getProduct(id: number, lang: Lang, db: Queryable = getPool()): Promise<Product | null> {
  const r = await one(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.id = $1`, [id], db);
  return r ? toProduct(r, lang) : null;
}

/** Products by id in the given order, each replaced by its local edit when there is one, without duplicates. */
async function loadEffective(ids: number[], lang: Lang): Promise<Product[]> {
  if (!ids.length) return [];
  const rows = await all(
    `SELECT ${COLUMNS}, coalesce(e.original, p.id) AS key
     FROM unnest($1::int[]) WITH ORDINALITY AS wanted(id, ord)
     LEFT JOIN (SELECT o.id AS edit, o.override_of AS original FROM products o WHERE o.override_of IS NOT NULL) e ON e.original = wanted.id
     JOIN products p ON p.id = coalesce(e.edit, wanted.id)
     LEFT JOIN product_prefs pp ON pp.product_id = p.id
     ORDER BY wanted.ord`,
    [ids],
  );
  const seen = new Set<number>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => toProduct(r, lang));
}

// ---------- Search ----------

/** Words of a query, lower case, letters and digits only (safe to put in a tsquery). */
export function queryWords(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/**
 * Local search: full text with prefixes ("volk brood" finds "volkoren brood") plus trigram similarity for typos.
 * Ranking: your own products, favourites and what you ate in the last 90 days first, then NEVO, then OFF.
 */
export async function searchProducts(q: string, lang: Lang, today: string, limit = 30): Promise<Product[]> {
  const words = queryWords(q);
  if (!words.length) return [];
  const tsquery = words.map((w) => `${w}:*`).join(' & ');
  // pg_trgm's default word similarity threshold (0.6) misses one-letter typos in short words ("yoghrt"); 0.45 finds
  // them without flooding the results. SET LOCAL keeps it to this query and still lets <% use the trigram index.
  const rows = await tx(async (c) => {
    await c.query(`SELECT set_config('pg_trgm.word_similarity_threshold', '0.45', true)`);
    return all(
    `WITH usage AS (
       SELECT product_id, count(*)::int AS uses FROM diary_entries
       WHERE product_id IS NOT NULL AND day >= $3::date GROUP BY product_id)
     SELECT ${COLUMNS},
       ts_rank(to_tsvector('simple', p.search_text), to_tsquery('simple', $1)) + word_similarity($2, p.search_text) AS score,
       coalesce(u.uses, 0) AS uses
     FROM ${FROM} LEFT JOIN usage u ON u.product_id = p.id
     WHERE (to_tsvector('simple', p.search_text) @@ to_tsquery('simple', $1) OR $2 <% p.search_text)
       AND ${NOT_OVERRIDDEN}
       AND pp.preference IS DISTINCT FROM 'hidden'
     ORDER BY CASE WHEN p.source = 'custom' OR u.uses > 0 OR pp.preference = 'favorite' THEN 0 WHEN p.source = 'nevo' THEN 1 ELSE 2 END,
       uses DESC, score DESC, length(p.search_text), p.id
     LIMIT $4`,
      [tsquery, words.join(' '), addDays(today, -90), limit],
      c,
    );
  });
  return rows.map((r) => toProduct(r, lang));
}

export async function productLists(lang: Lang, today: string): Promise<ProductLists> {
  const recent = await all<{ product_id: number }>(
    `SELECT product_id FROM diary_entries WHERE product_id IS NOT NULL
     GROUP BY product_id ORDER BY max(created_at) DESC LIMIT 25`,
  );
  const frequent = await all<{ product_id: number }>(
    `SELECT product_id FROM diary_entries WHERE product_id IS NOT NULL AND day >= $1::date
     GROUP BY product_id HAVING count(*) > 1 ORDER BY count(*) DESC, max(created_at) DESC LIMIT 25`,
    [addDays(today, -90)],
  );
  const byPref = async (pref: ProductPreference) =>
    (await all(`SELECT ${COLUMNS} FROM ${FROM} WHERE pp.preference = $1 AND ${NOT_OVERRIDDEN} ORDER BY lower(p.name_en)`, [pref])).map((r) =>
      toProduct(r, lang),
    );
  const mine = (await all(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.source = 'custom' ORDER BY lower(p.name_${lang}), p.id`)).map((r) => toProduct(r, lang));
  return {
    recent: (await loadEffective(recent.map((r) => r.product_id), lang)).filter((p) => p.preference !== 'hidden'),
    frequent: (await loadEffective(frequent.map((r) => r.product_id), lang)).filter((p) => p.preference !== 'hidden'),
    favorites: await byPref('favorite'),
    mine: mine.filter((p) => p.preference !== 'hidden'),
    hidden: await byPref('hidden'),
  };
}

// ---------- Your own products and local edits ----------

const nutrient = z.number().min(0).max(1000).nullable();

export const productInputSchema = z
  .object({
    nameEn: z.string().trim().max(160).default(''),
    nameNl: z.string().trim().max(160).default(''),
    brand: z.string().trim().max(120).default(''),
    barcode: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .default(null)
      .transform((b) => (b ? normalizeBarcode(b) ?? b : null)),
    unit: z.enum(['g', 'ml']).default('g'),
    per100: z.object({
      kcal: z.number().min(0).max(1000),
      protein: nutrient,
      carbs: nutrient,
      sugars: nutrient,
      fat: nutrient,
      satFat: nutrient,
      fibre: nutrient,
      salt: nutrient,
    }),
    servings: z
      .array(z.object({ label: z.string().trim().min(1).max(60), grams: z.number().positive().max(5000) }))
      .max(12)
      .default([]),
  })
  .strict()
  .refine((p) => p.nameEn || p.nameNl, { message: 'a name is required', path: ['nameEn'] })
  .refine((p) => new Set(p.servings.map((s) => s.label)).size === p.servings.length, { message: 'serving names must differ', path: ['servings'] });

function values(input: ProductInput): unknown[] {
  const n = input.per100;
  return [
    input.nameEn || input.nameNl,
    input.nameNl || input.nameEn,
    input.brand,
    input.barcode,
    input.unit,
    n.kcal,
    n.protein,
    n.carbs,
    n.sugars,
    n.fat,
    n.satFat,
    n.fibre,
    n.salt,
    JSON.stringify(input.servings),
  ];
}

export async function createProduct(raw: unknown, lang: Lang): Promise<Product> {
  const input = productInputSchema.parse(raw);
  const row = await one<{ id: number }>(
    `INSERT INTO products (source, name_en, name_nl, brand, barcode, unit, kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, servings)
     VALUES ('custom', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    values(input),
  );
  return (await getProduct(row!.id, lang))!;
}

/**
 * Saves changes. Your own product is changed in place. An OFF or NEVO product is never edited: the change is stored
 * as (or updates) a local edit that links to it, and from then on that edit stands in for it everywhere.
 */
export async function updateProduct(id: number, raw: unknown, lang: Lang): Promise<Product> {
  const input = productInputSchema.parse(raw);
  const current = await one<{ source: string; override_of: number | null }>('SELECT source, override_of FROM products WHERE id = $1', [id]);
  if (!current) throw new UserError(404, 'Product not found', 'Product niet gevonden');
  const set = `name_en = $2, name_nl = $3, brand = $4, barcode = $5, unit = $6, kcal = $7, protein = $8, carbs = $9, sugars = $10,
    fat = $11, sat_fat = $12, fibre = $13, salt = $14, servings = $15, updated_at = now()`;
  if (current.source === 'custom') {
    await run(`UPDATE products SET ${set} WHERE id = $1`, [id, ...values(input)]);
    return (await getProduct(id, lang))!;
  }
  const existing = await one<{ id: number }>('SELECT id FROM products WHERE override_of = $1', [id]);
  if (existing) {
    await run(`UPDATE products SET ${set} WHERE id = $1`, [existing.id, ...values(input)]);
    return (await getProduct(existing.id, lang))!;
  }
  const row = await one<{ id: number }>(
    `INSERT INTO products (source, override_of, name_en, name_nl, brand, barcode, unit, kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, servings, extra)
     SELECT 'custom', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, extra FROM products WHERE id = $1
     RETURNING id`,
    [id, ...values(input)],
  );
  // Marks follow the product you see.
  await run('UPDATE product_prefs SET product_id = $2 WHERE product_id = $1', [id, row!.id]);
  return (await getProduct(row!.id, lang))!;
}

/** Deletes your own product (or a local edit, which brings back the original). Logged entries keep their values. */
export async function deleteProduct(id: number): Promise<void> {
  const current = await one<{ source: string; override_of: number | null }>('SELECT source, override_of FROM products WHERE id = $1', [id]);
  if (!current) return;
  if (current.source !== 'custom')
    throw new UserError(400, 'Products from a food database cannot be deleted; hide them instead.', 'Producten uit een voedingsdatabase kun je niet verwijderen; verberg ze in plaats daarvan.');
  if (current.override_of) await run('UPDATE product_prefs SET product_id = $2 WHERE product_id = $1', [id, current.override_of]).catch(() => {});
  await run('DELETE FROM products WHERE id = $1', [id]);
}

export async function setPreference(id: number, preference: ProductPreference | null): Promise<void> {
  if (!(await one('SELECT 1 FROM products WHERE id = $1', [id]))) throw new UserError(404, 'Product not found', 'Product niet gevonden');
  if (preference === null) await run('DELETE FROM product_prefs WHERE product_id = $1', [id]);
  else
    await run(
      `INSERT INTO product_prefs (product_id, preference, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (product_id) DO UPDATE SET preference = excluded.preference, updated_at = excluded.updated_at`,
      [id, preference],
    );
}

// ---------- Barcodes and the OFF cache ----------

export async function upsertOffProduct(p: OffProduct): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO products (source, source_id, barcode, name_en, name_nl, brand, unit, kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, extra, servings, fetched_at, updated_at)
     VALUES ('off', $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
     ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
       name_en = excluded.name_en, name_nl = excluded.name_nl, brand = excluded.brand, unit = excluded.unit, kcal = excluded.kcal,
       protein = excluded.protein, carbs = excluded.carbs, sugars = excluded.sugars, fat = excluded.fat, sat_fat = excluded.sat_fat,
       fibre = excluded.fibre, salt = excluded.salt, extra = excluded.extra, servings = excluded.servings, fetched_at = now(), updated_at = now()
     RETURNING id`,
    [
      p.barcode,
      p.nameEn,
      p.nameNl,
      p.brand,
      p.unit,
      p.per100.kcal,
      p.per100.protein,
      p.per100.carbs,
      p.per100.sugars,
      p.per100.fat,
      p.per100.satFat,
      p.per100.fibre,
      p.per100.salt,
      JSON.stringify(p.extra),
      JSON.stringify(p.servings),
    ],
  );
  return row!.id;
}

/** Barcodes OFF doesn't know, so a second scan doesn't cost another request. Forgotten after a day. */
const misses = new Map<string, number>();
const MISS_MS = 86_400_000;

export function clearBarcodeMisses() {
  misses.clear();
}

/**
 * Finds a product by barcode: your own products first, then the OFF cache, then the OFF API (throttled). A cached
 * product older than OFF_REFRESH_DAYS is fetched again; when that fails the cached copy is used.
 */
export async function lookupBarcode(input: string, lang: Lang): Promise<Product> {
  const code = normalizeBarcode(input);
  if (!code) throw new UserError(400, 'That is not a valid barcode (8 to 14 digits).', 'Dat is geen geldige barcode (8 tot 14 cijfers).');

  const own = await one<{ id: number }>(`SELECT id FROM products WHERE source = 'custom' AND barcode = $1 ORDER BY override_of NULLS FIRST, id LIMIT 1`, [code]);
  if (own) return (await loadEffective([own.id], lang))[0];

  const cached = await one<{ id: number; fetched_at: string | null }>(`SELECT id, fetched_at FROM products WHERE source = 'off' AND source_id = $1`, [code]);
  const fresh = cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < config.off.refreshDays * 86_400_000;
  if (cached && fresh) return (await loadEffective([cached.id], lang))[0];

  if (!cached && (misses.get(code) ?? 0) > Date.now()) throw notFound();

  const result = await fetchOffProduct(code);
  if (result.status === 'found') {
    misses.delete(code);
    return (await loadEffective([await upsertOffProduct(result.product)], lang))[0];
  }
  if (cached) return (await loadEffective([cached.id], lang))[0];
  switch (result.status) {
    case 'not_found':
    case 'unusable':
      misses.set(code, Date.now() + MISS_MS);
      throw notFound();
    case 'throttled':
      throw new UserError(429, 'Too many lookups at Open Food Facts. Try again in a minute.', 'Te veel opzoekingen bij Open Food Facts. Probeer het over een minuut opnieuw.');
    default:
      throw new UserError(502, 'Open Food Facts cannot be reached right now.', 'Open Food Facts is nu niet bereikbaar.');
  }
}

function notFound() {
  return new UserError(404, 'No product with this barcode. You can add it yourself.', 'Geen product met deze barcode. Je kunt het zelf toevoegen.');
}
