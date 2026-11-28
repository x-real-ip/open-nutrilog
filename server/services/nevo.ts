// NEVO (RIVM, Dutch food composition database). Free, but NOT open data: you get it only after accepting RIVM's
// conditions, it may only be used unchanged and with a source reference. So it is never in this repo or the image:
// you import the file you downloaded (Profile → Data, or `npm run import:nevo -- <file>`). Rows are stored
// read-only with their version; a local edit is an override, never a change to a NEVO row.
//
// The importer reads the CSV from NEVO-online (or the .zip it comes in) and finds its columns by their NEVO codes
// (NEVO-code, ENERCC, PROT, CHO, SUGAR, FAT, FASAT, FIBT, NA/NACL), whatever the delimiter or decimal mark.
import type { Nutrients } from '../../shared/nutrition.ts';
import { KJ_PER_KCAL, round } from '../../shared/nutrition.ts';
import { getSetting, run, tx } from '../db.ts';
import { loc, UserError, type Localized } from '../i18n.ts';
import { isZip, readZip, type ZipEntry } from './zip.ts';

export interface NevoFood {
  code: string;
  nameNl: string;
  nameEn: string;
  per100: Nutrients;
  extra: Record<string, { value: number; unit: string }>;
}

export interface NevoStatus {
  version: string;
  importedAt: string;
  count: number;
}

/** UTF-8 (with or without BOM), or Latin-1 for older exports. */
export function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  const text = utf8.includes('�') ? buf.toString('latin1') : utf8;
  return text.replace(/^﻿/, '');
}

/** One line of delimited text into fields, with "quoted" fields and "" escapes. */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

export function detectDelimiter(header: string): string {
  const counts = ['|', ';', '\t', ','].map((d) => [d, header.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** "1,5", "1.5", "" (unknown), "-", "<0,1" (a trace: 0). */
export function nevoNumber(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!t || t === '-' || t === '.') return null;
  if (t.startsWith('<')) return 0;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const MAIN = new Set(['ENERCC', 'ENERCJ', 'PROT', 'CHO', 'SUGAR', 'FAT', 'FASAT', 'FIBT', 'NACL']);

interface NevoColumns {
  delimiter: string;
  codeCol: number;
  nlCol: number;
  enCol: number;
  nutrientCols: { i: number; code: string; unit: string }[];
}

/** The columns of a NEVO table from its header line, or null when it isn't the NEVO table. */
export function nevoColumns(headerLine: string): NevoColumns | null {
  const delimiter = detectDelimiter(headerLine);
  const header = splitLine(headerLine, delimiter);
  const find = (test: (h: string) => boolean) => header.findIndex((h) => test(h.toLowerCase()));
  const codeCol = find((h) => /^nevo[- _]?code$/.test(h));
  const nlCol = find((h) => h.includes('voedingsmiddelnaam') || h.includes('dutch food name'));
  const enCol = find((h) => h.includes('engelse naam') || h.includes('english name') || (h.includes('food name') && !h.includes('dutch')));
  // Nutrient columns look like "ENERCC (kcal)" or "PROT (g)".
  const nutrientCols = header.flatMap((h, i) => {
    const m = /^([A-Z][A-Z0-9_]*)\s*\(([^)]+)\)$/.exec(h.trim());
    return m ? [{ i, code: m[1], unit: m[2].trim() }] : [];
  });
  const has = (code: string) => nutrientCols.some((c) => c.code === code);
  if (codeCol < 0 || nlCol < 0 || (!has('ENERCC') && !has('ENERCJ'))) return null;
  return { delimiter, codeCol, nlCol, enCol, nutrientCols };
}

/** Parses one NEVO CSV. Returns null when the text isn't a NEVO table. */
export function parseNevoCsv(text: string): NevoFood[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const cols = nevoColumns(lines[0]);
  if (!cols) return null;
  const { delimiter, codeCol, nlCol, enCol, nutrientCols } = cols;
  const col = (code: string) => nutrientCols.find((c) => c.code === code);

  const foods: NevoFood[] = [];
  for (const line of lines.slice(1)) {
    const f = splitLine(line, delimiter);
    const code = f[codeCol]?.trim();
    const nameNl = f[nlCol]?.trim();
    if (!code || !nameNl) continue;
    const value = (code: string) => {
      const c = col(code);
      return c ? nevoNumber(f[c.i]) : null;
    };
    const kj = value('ENERCJ');
    const kcal = value('ENERCC') ?? (kj !== null ? kj / KJ_PER_KCAL : null);
    if (kcal === null) continue;
    // Salt: NACL when given (g or mg), else sodium (mg) × 2.5.
    const nacl = col('NACL');
    const naclValue = value('NACL');
    const sodium = value('NA');
    const salt = naclValue !== null ? naclValue / (nacl?.unit.toLowerCase() === 'mg' ? 1000 : 1) : sodium !== null ? (sodium * 2.5) / 1000 : null;
    const extra: NevoFood['extra'] = {};
    for (const c of nutrientCols) {
      if (MAIN.has(c.code)) continue;
      const v = nevoNumber(f[c.i]);
      if (v !== null) extra[c.code] = { value: v, unit: c.unit };
    }
    foods.push({
      code,
      nameNl,
      nameEn: (enCol >= 0 ? f[enCol]?.trim() : '') || nameNl,
      per100: {
        kcal: round(kcal, 1),
        protein: value('PROT'),
        carbs: value('CHO'),
        sugars: value('SUGAR'),
        fat: value('FAT'),
        satFat: value('FASAT'),
        fibre: value('FIBT'),
        salt: salt === null ? null : round(salt, 3),
      },
      extra,
    });
  }
  return foods;
}

/** "NEVO2025_9.0.csv" → "2025/9.0" (the way RIVM writes the version). */
export function versionFromName(name: string): string | null {
  const m = /NEVO[ _-]?(?:online[ _-]?)?(\d{4})[ _-]*v?(\d+[.,]\d+)/i.exec(name);
  return m ? `${m[1]}/${m[2].replace(',', '.')}` : null;
}

/** The NEVO table itself is a few MB; anything far bigger is not it, and unpacking it would only use up memory. */
export const MAX_NEVO_TABLE_BYTES = 64 * 1024 * 1024;

/**
 * The NEVO table in a zip: only the first line of each CSV is unpacked to see whether it is the table (the download
 * also holds detail tables of hundreds of MB). When several are, the largest wins.
 */
export function pickNevoEntry(entries: ZipEntry[]): ZipEntry | null {
  const tables = entries.filter((e) => /\.(csv|txt)$/i.test(e.name) && nevoColumns(decodeText(e.head()).split(/\r?\n/)[0] ?? '') !== null);
  return tables.sort((a, b) => b.size - a.size)[0] ?? null;
}

/** A CSV, or a .zip with the CSV inside. */
export function parseNevoFile(buf: Buffer, filename: string): { foods: NevoFood[]; version: string | null } {
  if (isZip(buf)) {
    const entry = pickNevoEntry(readZip(buf));
    if (!entry) throw notNevo();
    if (entry.size > MAX_NEVO_TABLE_BYTES)
      throw new UserError(400, `${entry.name} is too large to be the NEVO table.`, `${entry.name} is te groot om de NEVO-tabel te zijn.`);
    const foods = parseNevoCsv(decodeText(entry.read()));
    if (!foods) throw notNevo();
    return { foods, version: versionFromName(entry.name) ?? versionFromName(filename) };
  }
  const foods = parseNevoCsv(decodeText(buf));
  if (!foods) throw notNevo();
  return { foods, version: versionFromName(filename) };
}

function notNevo() {
  return new UserError(
    400,
    'This is not a NEVO file. Use the CSV from NEVO-online (or the .zip it comes in); Excel files are not supported.',
    'Dit is geen NEVO-bestand. Gebruik de CSV van NEVO-online (of de .zip waarin die zit); Excel-bestanden worden niet ondersteund.',
  );
}

/**
 * Imports (or updates) NEVO. Rows are matched by NEVO code; foods that are gone from the new version are removed
 * unless a recipe uses them. Logged entries keep their own values either way.
 */
export async function importNevo(buf: Buffer, filename: string, versionOverride?: string | null): Promise<NevoStatus> {
  const { foods, version: detected } = parseNevoFile(buf, filename);
  if (!foods.length) throw notNevo();
  const version = (versionOverride?.trim() || detected || 'unknown').slice(0, 20);
  await tx(async (c) => {
    for (const f of foods) {
      const n = f.per100;
      await run(
        `INSERT INTO products (source, source_id, name_en, name_nl, unit, kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, extra, source_version, updated_at)
         VALUES ('nevo', $1, $2, $3, 'g', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
           name_en = excluded.name_en, name_nl = excluded.name_nl, kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs,
           sugars = excluded.sugars, fat = excluded.fat, sat_fat = excluded.sat_fat, fibre = excluded.fibre, salt = excluded.salt,
           extra = excluded.extra, source_version = excluded.source_version, updated_at = now()`,
        [f.code, f.nameEn, f.nameNl, n.kcal, n.protein, n.carbs, n.sugars, n.fat, n.satFat, n.fibre, n.salt, JSON.stringify(f.extra), version],
        c,
      );
    }
    await run(
      `DELETE FROM products p WHERE p.source = 'nevo' AND NOT (p.source_id = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM recipe_ingredients r WHERE r.product_id = p.id)`,
      [foods.map((f) => f.code)],
      c,
    );
    const status: NevoStatus = { version, importedAt: new Date().toISOString(), count: foods.length };
    await run(`INSERT INTO settings (key, value) VALUES ('nevo', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(status)], c);
  });
  return (await nevoStatus())!;
}

export async function nevoStatus(): Promise<NevoStatus | null> {
  const raw = await getSetting('nevo');
  try {
    return raw ? (JSON.parse(raw) as NevoStatus) : null;
  } catch {
    return null;
  }
}

/** The source reference RIVM's conditions ask for, with the imported version. */
export function nevoAttribution(version: string): Localized {
  return loc(`Based on data from NEVO-online version ${version}, RIVM, Bilthoven.`, `Gebaseerd op gegevens uit NEVO-online versie ${version}, RIVM, Bilthoven.`);
}
