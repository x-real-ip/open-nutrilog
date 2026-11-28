// JSON export and import, and a CSV of the diary. Database-level backups (pg_dump, storage snapshots) are handled
// outside the app.
//
// NEVO data never leaves the app in an export (RIVM's conditions): the export has only the NEVO codes of the
// products it refers to. An import keeps the NEVO data that is already there and points those references at it by
// code; without NEVO they become empty (logged entries keep their values).
import { all, IDENTITY_TABLES, one, run, TABLES, tx } from '../db.ts';
import { pick, UserError } from '../i18n.ts';
import { ensureMeals } from './meals.ts';

export const EXPORT_APP = 'open-nutrilog';

/** Columns that point at a product, per table; NEVO ids are mapped through their codes on import. */
const PRODUCT_REFS: Record<string, string[]> = {
  products: ['override_of'],
  product_prefs: ['product_id'],
  recipe_ingredients: ['product_id'],
  diary_entries: ['product_id'],
};
/** Rows that make no sense without their product. */
const DROP_WITHOUT_PRODUCT = new Set(['product_prefs', 'recipe_ingredients']);

export async function exportJson() {
  const tables: Record<string, unknown[]> = {};
  // In key order, so a product's local edit comes after the product it points at.
  for (const t of TABLES) {
    tables[t] = await all(t === 'products' ? `SELECT * FROM products WHERE source <> 'nevo' ORDER BY id` : `SELECT * FROM ${t} ORDER BY 1`);
  }
  const nevoRefs = await all<{ id: number; code: string }>(`SELECT id, source_id AS code FROM products WHERE source = 'nevo' ORDER BY id`);
  const version = (await one<{ v: number }>('SELECT max(version) AS v FROM schema_migrations'))?.v ?? 0;
  return { app: EXPORT_APP, format: 1, schemaVersion: version, exportedAt: new Date().toISOString(), tables, nevoRefs };
}

type ColumnInfo = { column_name: string; data_type: string };

function coerce(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  return value;
}

/** Replaces all data with the export's, keeping NEVO. An export without tables empties everything else (the e2e tests use that). */
export async function importJson(data: any) {
  if (!data || data.app !== EXPORT_APP || typeof data.tables !== 'object')
    throw new UserError(400, 'This is not an Open Nutrilog export file', 'Dit is geen exportbestand van Open Nutrilog');
  await tx(async (c) => {
    // Keep NEVO aside: it isn't in the export and may not be.
    await run(`CREATE TEMP TABLE nevo_keep ON COMMIT DROP AS SELECT * FROM products WHERE source = 'nevo'`, [], c);
    await run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`, [], c);

    const columnTypes = async (t: string) =>
      new Map(
        (
          await all<ColumnInfo>(
            // Generated columns (the search text) are computed by Postgres and can't be inserted.
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = current_schema() AND is_generated = 'NEVER'`,
            [t],
            c,
          )
        ).map((col) => [col.column_name, col.data_type]),
      );

    // NEVO goes back first, with ids above the export's own products so they never collide.
    const exportedProducts = (data.tables.products as Record<string, unknown>[] | undefined) ?? [];
    const maxId = Math.max(0, ...exportedProducts.map((p) => Number(p.id) || 0));
    const kept = await all<{ id: number; source_id: string }>('SELECT id, source_id FROM nevo_keep ORDER BY id', [], c);
    const nevoByCode = new Map<string, number>();
    const productCols = [...(await columnTypes('products')).keys()].filter((k) => k !== 'id');
    for (const [i, k] of kept.entries()) {
      const newId = maxId + i + 1;
      await run(`INSERT INTO products (id, ${productCols.join(', ')}) SELECT $1, ${productCols.join(', ')} FROM nevo_keep WHERE id = $2`, [newId, k.id], c);
      nevoByCode.set(k.source_id, newId);
    }
    // Export id of a NEVO product → its id here (null when this app has no NEVO, or not that food).
    const nevoIds = new Map<number, number | null>();
    for (const ref of (data.nevoRefs as { id: number; code: string }[] | undefined) ?? []) nevoIds.set(Number(ref.id), nevoByCode.get(ref.code) ?? null);

    for (const t of TABLES) {
      const rows = data.tables[t] as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const types = await columnTypes(t);
      for (const original of rows) {
        if (t === 'products' && original.source === 'nevo') continue;
        const row = { ...original };
        let dropped = false;
        for (const col of PRODUCT_REFS[t] ?? []) {
          const ref = row[col];
          if (ref === null || ref === undefined || !nevoIds.has(Number(ref))) continue;
          row[col] = nevoIds.get(Number(ref));
          if (row[col] === null && DROP_WITHOUT_PRODUCT.has(t)) dropped = true;
        }
        if (dropped) continue;
        const cols = Object.keys(row).filter((k) => types.has(k));
        if (!cols.length) continue;
        await run(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          cols.map((k) => coerce(row[k], types.get(k)!)),
          c,
        );
      }
    }
    // Continue identity sequences after the highest id.
    for (const t of IDENTITY_TABLES) {
      await run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce((SELECT max(id) FROM ${t}), 0) + 1, false)`, [], c);
    }
    // A diary always has meals; an export without them gets the defaults back.
    await ensureMeals(c);
  });
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every diary entry, for spreadsheets. A data file: English meal names and decimal points, whatever the app language. */
export async function exportDiaryCsv(): Promise<string> {
  const rows = await all(
    `SELECT e.day, m.name AS meal, e.name, e.brand, e.source, e.amount, e.unit, e.serving_label, e.quantity,
       e.kcal, e.protein, e.carbs, e.sugars, e.fat, e.sat_fat, e.fibre, e.salt, e.ai_estimate
     FROM diary_entries e JOIN meals m ON m.id = e.meal_id
     ORDER BY e.day, m.position, e.created_at, e.id`,
  );
  const header = 'date,meal,food,brand,source,amount,unit,serving,grams,kcal,protein_g,carbs_g,sugars_g,fat_g,saturated_fat_g,fibre_g,salt_g,ai_estimate';
  const lines = rows.map((r) =>
    [r.day, pick(r.meal, 'en'), pick(r.name, 'en'), r.brand, r.source ?? 'quick', r.amount, r.unit, r.serving_label, r.quantity, r.kcal, r.protein, r.carbs, r.sugars, r.fat, r.sat_fat, r.fibre, r.salt, r.ai_estimate]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}
