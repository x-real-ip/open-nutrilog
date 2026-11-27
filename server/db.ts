import pg from 'pg';
import { config } from './config.ts';

// Return timestamps as ISO strings and 64-bit integers/numerics as JS numbers,
// so rows look the same as the rest of the code expects.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString()); // timestamp
pg.types.setTypeParser(1082, (v) => v); // date: keep YYYY-MM-DD, no time zone shift
pg.types.setTypeParser(20, (v) => Number(v)); // int8 (COUNT)
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (SUM of integers)

export type Queryable = pg.Pool | pg.PoolClient;

// Each entry is one schema version; append only, never edit a shipped migration.
const migrations: string[] = [
  // 1: the single user's profile and app settings (session secret, later AI settings).
  `
  CREATE TABLE profile (
    id integer PRIMARY KEY CHECK (id = 1),
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL
  );

  CREATE TABLE settings (
    key text PRIMARY KEY,
    value text NOT NULL
  );
  `,
];

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not opened');
  return pool;
}

/**
 * Connects (DATABASE_URL or the standard PG* variables). Pending migrations run first
 * unless `migrate` is false, e.g. when an init container already ran `npm run migrate`.
 */
export async function openDb(connectionString = config.databaseUrl, opts: { migrate?: boolean } = {}): Promise<pg.Pool> {
  pool = new pg.Pool({
    connectionString: connectionString || undefined,
    max: config.dbPoolSize,
    ssl: config.dbSsl ? { rejectUnauthorized: config.dbSslVerify } : undefined,
  });
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  if (opts.migrate ?? true) await migrate(pool);
  return pool;
}

/** True when the database answers a trivial query. */
export async function databaseReady(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

// Fixed key so concurrent replicas never migrate at the same time.
const MIGRATION_LOCK = 742_031_338;

/**
 * Applies pending migrations and returns how many ran. Idempotent: a second run is a
 * no-op. The advisory lock keeps concurrent runs (init container + app) from colliding.
 */
export async function migrate(p: pg.Pool = getPool()): Promise<{ from: number; to: number }> {
  const client = await p.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
    const from = rows[0].v ?? 0;
    for (let v = from; v < migrations.length; v++) {
      await client.query('BEGIN');
      try {
        await client.query(migrations[v]);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [v + 1]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return { from, to: Math.max(from, migrations.length) };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

export async function all<T = any>(sql: string, params: unknown[] = [], db: Queryable = getPool()): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Queryable = getPool()): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

export async function run(sql: string, params: unknown[] = [], db: Queryable = getPool()): Promise<number> {
  return (await db.query(sql, params)).rowCount ?? 0;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const nowIso = () => new Date().toISOString();

export async function getSetting(key: string): Promise<string | null> {
  return (await one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null;
}

/** Insert only if absent and return the stored value (safe when several replicas race). */
export async function ensureSetting(key: string, value: string): Promise<string> {
  await run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  return (await getSetting(key))!;
}

/** Tables in dependency order; used by export/import. Settings stay out: they hold the session secret. */
export const TABLES = ['profile'] as const;

/** Tables with identity columns whose sequence must follow imported ids. */
export const IDENTITY_TABLES: readonly string[] = [];
