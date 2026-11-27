// JSON export and import. Database-level backups (pg_dump, storage snapshots) are handled
// outside the app.
import { all, IDENTITY_TABLES, one, run, TABLES, tx } from '../db.ts';
import { UserError } from '../i18n.ts';
import { ensureMeals } from './meals.ts';

export const EXPORT_APP = 'open-nutrilog';

export async function exportJson() {
  const tables: Record<string, unknown[]> = {};
  // In key order, so a product's local edit comes after the product it points at.
  for (const t of TABLES) tables[t] = await all(`SELECT * FROM ${t} ORDER BY 1`);
  const version = (await one<{ v: number }>('SELECT max(version) AS v FROM schema_migrations'))?.v ?? 0;
  return { app: EXPORT_APP, format: 1, schemaVersion: version, exportedAt: new Date().toISOString(), tables };
}

type ColumnInfo = { column_name: string; data_type: string };

function coerce(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  return value;
}

/** Replaces all data with the export's. An export without tables empties everything (the e2e tests use that). */
export async function importJson(data: any) {
  if (!data || data.app !== EXPORT_APP || typeof data.tables !== 'object')
    throw new UserError(400, 'This is not an Open Nutrilog export file', 'Dit is geen exportbestand van Open Nutrilog');
  await tx(async (c) => {
    await run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`, [], c);
    for (const t of TABLES) {
      const rows = data.tables[t] as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const columns = await all<ColumnInfo>(
        // Generated columns (the search text) are computed by Postgres and can't be inserted.
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = current_schema() AND is_generated = 'NEVER'`,
        [t],
        c,
      );
      const types = new Map(columns.map((col) => [col.column_name, col.data_type]));
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => types.has(k));
        if (!cols.length) continue;
        await run(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          cols.map((k) => coerce(row[k], types.get(k)!)),
          c,
        );
      }
    }
    // Continue identity sequences after the highest imported id.
    for (const t of IDENTITY_TABLES) {
      await run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce((SELECT max(id) FROM ${t}), 0) + 1, false)`, [], c);
    }
    // A diary always has meals; an export without them gets the defaults back.
    await ensureMeals(c);
  });
}
