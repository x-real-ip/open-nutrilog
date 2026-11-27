// npm run import:off [-- --file <dump.csv.gz>]
// Streams the Open Food Facts CSV export (OFF_DUMP_URL, about 1.5 GB gzipped) and keeps the products sold in
// OFF_IMPORT_COUNTRIES (the Netherlands and Belgium by default) with usable nutrition data. Also runs as a weekly
// CronJob in the cluster. Safe to run again: products are upserted by barcode.
import { closeDb, openDb } from '../db.ts';
import { importOffDump } from '../services/offDump.ts';

const args = process.argv.slice(2);
const fIndex = args.indexOf('--file');
const file = fIndex >= 0 ? args[fIndex + 1] : undefined;
const started = Date.now();

try {
  await openDb();
  const result = await importOffDump({ file, log: (m) => console.log(m) });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`Read ${result.scanned} products, ${result.matched} from the chosen countries, ${result.imported} imported (${minutes} min).`);
  await closeDb();
} catch (err) {
  console.error('Open Food Facts import failed:', (err as Error).message);
  await closeDb().catch(() => {});
  process.exit(1);
}
