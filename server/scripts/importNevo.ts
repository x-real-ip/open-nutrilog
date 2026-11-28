// npm run import:nevo -- <file> [--version 2025/9.0]
// Imports the NEVO file you downloaded from NEVO-online (the CSV, or the .zip it comes in). Same as
// Profile → Data → Import NEVO file in the app.
import fs from 'node:fs';
import path from 'node:path';
import { closeDb, openDb } from '../db.ts';
import { importNevo } from '../services/nevo.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const vIndex = args.indexOf('--version');
const version = vIndex >= 0 ? args[vIndex + 1] : undefined;
if (!file) {
  console.error('Usage: npm run import:nevo -- <NEVO csv or zip> [--version 2025/9.0]');
  process.exit(2);
}

try {
  await openDb();
  const status = await importNevo(fs.readFileSync(file), path.basename(file), version);
  console.log(`Imported ${status.count} NEVO foods (version ${status.version}).`);
  await closeDb();
} catch (err) {
  console.error('NEVO import failed:', (err as Error).message);
  await closeDb().catch(() => {});
  process.exit(1);
}
