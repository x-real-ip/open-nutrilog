// Import of the Dutch/Belgian part of the official Open Food Facts dump, for fast local text search
// (`npm run import:off`, also as a weekly CronJob). The dump is about 1.5 GB gzipped and 3.7M+ products; it is
// streamed (download → gunzip → line by line), so it needs no disk and little memory. Only products sold in the
// chosen countries with usable nutrition data (energy) are kept and upserted by barcode. Your own products and
// local edits are never touched; cached products are refreshed.
import fs from 'node:fs';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { config } from '../config.ts';
import { run } from '../db.ts';
import { mapOff, normalizeBarcode, userAgent, type OffProduct } from './off.ts';
import { upsertOffProducts } from './products.ts';

export interface DumpOptions {
  /** A local file (plain or .gz); otherwise `url` (default OFF_DUMP_URL). */
  file?: string;
  url?: string;
  /** countries_tags to keep, e.g. en:netherlands. */
  countries?: string[];
  batchSize?: number;
  log?: (message: string) => void;
}

export interface DumpResult {
  scanned: number;
  matched: number;
  imported: number;
}

/** One dump row (tab-separated, OFF's CSV export) in the shape mapOff() reads. */
export function rowToOff(header: string[], fields: string[]): Record<string, unknown> {
  const get = (name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? fields[i] : undefined;
  };
  const nutriments: Record<string, string> = {};
  header.forEach((h, i) => {
    if (h.endsWith('_100g') && fields[i]) nutriments[h] = fields[i];
  });
  return {
    code: get('code'),
    product_name: get('product_name'),
    generic_name: get('generic_name'),
    brands: get('brands'),
    quantity: get('quantity'),
    serving_size: get('serving_size'),
    serving_quantity: get('serving_quantity'),
    nutriments,
  };
}

async function openStream(opts: DumpOptions): Promise<NodeJS.ReadableStream> {
  if (opts.file) {
    const raw = fs.createReadStream(opts.file);
    return opts.file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  }
  const url = opts.url ?? config.off.dumpUrl;
  const res = await fetch(url, { headers: { 'user-agent': userAgent() } });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const body = Readable.fromWeb(res.body as never);
  return url.endsWith('.gz') ? body.pipe(zlib.createGunzip()) : body;
}

export async function importOffDump(opts: DumpOptions = {}): Promise<DumpResult> {
  const countries = (opts.countries ?? config.off.importCountries).map((c) => c.trim()).filter(Boolean);
  const batchSize = opts.batchSize ?? 500;
  const log = opts.log ?? (() => {});
  const input = await openStream(opts);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  let header: string[] | null = null;
  let countriesCol = -1;
  const result: DumpResult = { scanned: 0, matched: 0, imported: 0 };
  let batch: OffProduct[] = [];
  const flush = async () => {
    if (!batch.length) return;
    result.imported += await upsertOffProducts(batch);
    batch = [];
  };

  for await (const line of lines) {
    if (!header) {
      header = line.split('\t');
      countriesCol = header.indexOf('countries_tags');
      if (header.indexOf('code') < 0 || countriesCol < 0) throw new Error('this is not an Open Food Facts CSV export');
      continue;
    }
    result.scanned++;
    if (result.scanned % 500_000 === 0) log(`${result.scanned} products read, ${result.imported} imported`);
    // Cheap test first: most lines are from other countries.
    if (!countries.some((c) => line.includes(c))) continue;
    const fields = line.split('\t');
    const tags = (fields[countriesCol] ?? '').split(',');
    if (!countries.some((c) => tags.includes(c))) continue;
    result.matched++;
    const product = mapOff(rowToOff(header, fields));
    const code = product && normalizeBarcode(product.barcode);
    if (!product || !code || !product.nameNl) continue;
    batch.push({ ...product, barcode: code });
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  await run(`INSERT INTO settings (key, value) VALUES ('off_import', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [
    JSON.stringify({ at: new Date().toISOString(), ...result, countries }),
  ]);
  return result;
}
