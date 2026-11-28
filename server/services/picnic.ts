// Picnic (optional, experimental). Picnic has no official API; this uses the unofficial one (the `picnic-api`
// package, which the Home Assistant integration's library also follows) and can stop working whenever Picnic
// changes it. Only reading: your recent deliveries and product pages. Linking stores the auth key Picnic hands out
// (settings key 'picnic'); your password is never stored and the key never reaches the browser. Products read from
// Picnic are kept like the Open Food Facts cache (source 'picnic').
import picnicApi from 'picnic-api';
import type { PicnicArticle, PicnicImport, PicnicStatus } from '../../shared/types.ts';
import { KJ_PER_KCAL, round, type Nutrients } from '../../shared/nutrition.ts';
import { all, getSetting, one, run } from '../db.ts';
import { UserError, type Lang } from '../i18n.ts';
import { getProduct } from './products.ts';

// ---------- The connection (swappable for tests) ----------

export interface PicnicDelivery {
  id: string;
  deliveredAt: string | null;
  articles: { id: string; name: string; unitQuantity: string }[];
}

export interface PicnicProductPage {
  name: string;
  brand: string | null;
  unitQuantity: string;
  sections: { title: string; content: string }[];
}

export interface PicnicApi {
  login(email: string, password: string): Promise<{ authKey: string; needs2fa: boolean }>;
  send2fa(authKey: string, channel: 'SMS' | 'EMAIL'): Promise<void>;
  /** Returns the auth key to keep after a successful code. */
  verify2fa(authKey: string, code: string): Promise<string>;
  deliveries(authKey: string, count: number): Promise<PicnicDelivery[]>;
  product(authKey: string, id: string): Promise<PicnicProductPage>;
}

/** Thrown when Picnic no longer accepts the stored key. */
export class PicnicAuthError extends Error {}

const PicnicClient = ((picnicApi as unknown as { default?: unknown }).default ?? picnicApi) as new (o: { countryCode: string; authKey?: string }) => any;

function isAuthProblem(err: unknown): boolean {
  return /\b(401|403)\b|unauthori[sz]ed|AUTH_INVALID|auth key/i.test(String((err as Error)?.message ?? err));
}

const real: PicnicApi = {
  async login(email, password) {
    const c = new PicnicClient({ countryCode: 'NL' });
    const r = await c.auth.login(email, password);
    return { authKey: r.authKey, needs2fa: Boolean(r.second_factor_authentication_required) };
  },
  async send2fa(authKey, channel) {
    await new PicnicClient({ countryCode: 'NL', authKey }).auth.generate2FACode(channel);
  },
  async verify2fa(authKey, code) {
    const c = new PicnicClient({ countryCode: 'NL', authKey });
    await c.auth.verify2FACode(code);
    return c.http?.authKey ?? authKey;
  },
  async deliveries(authKey, count) {
    const c = new PicnicClient({ countryCode: 'NL', authKey });
    try {
      const list = ((await c.delivery.getDeliveries(['COMPLETED'])) ?? []).slice(0, count);
      const out: PicnicDelivery[] = [];
      for (const d of list) {
        const detail = await c.delivery.getDelivery(d.delivery_id);
        const articles = (detail.orders ?? []).flatMap((o: any) =>
          (o.items ?? []).flatMap((line: any) => (line.items ?? []).map((a: any) => ({ id: String(a.id), name: String(a.name), unitQuantity: String(a.unit_quantity ?? '') }))),
        );
        out.push({ id: d.delivery_id, deliveredAt: d.delivery_time?.start ?? null, articles });
      }
      return out;
    } catch (err) {
      if (isAuthProblem(err)) throw new PicnicAuthError(String(err));
      throw err;
    }
  },
  async product(authKey, id) {
    try {
      const p = await new PicnicClient({ countryCode: 'NL', authKey }).catalog.getProductDetails(id);
      return { name: p.name, brand: p.brand, unitQuantity: p.unitQuantity ?? '', sections: (p.infoSections ?? []).map((s: any) => ({ title: s.title, content: s.content })) };
    } catch (err) {
      if (isAuthProblem(err)) throw new PicnicAuthError(String(err));
      throw err;
    }
  },
};

let api: PicnicApi = real;
/** Tests use a fake Picnic. */
export function setPicnicApi(fake: PicnicApi | null) {
  api = fake ?? real;
  articleCache = null;
}

// ---------- Reading nutrition values from Picnic's text ----------

/** "9,5" → 9.5, "<0,5" → 0 (a trace), "" → null. */
function number(text: string): number | null {
  const t = text.trim();
  if (t.startsWith('<')) return 0;
  const m = /-?\d+(?:[.,]\d+)?/.exec(t);
  return m ? Number(m[0].replace(',', '.')) : null;
}

const LABELS: { key: keyof Nutrients | 'kj' | 'sodium'; test: RegExp }[] = [
  // More specific first: "waarvan verzadigde vetzuren" also contains "vet".
  { key: 'satFat', test: /verzadigd|saturat/ },
  { key: 'sugars', test: /suiker|sugar/ },
  { key: 'fibre', test: /vezel|fib(re|er)/ },
  { key: 'salt', test: /^\W*(zout|salt)\b/ },
  { key: 'sodium', test: /natrium|sodium/ },
  { key: 'protein', test: /eiwit|protein/ },
  { key: 'carbs', test: /koolhydra|carbohydrat/ },
  { key: 'fat', test: /\bvet|\bfat/ },
  { key: 'kcal', test: /energie|energy/ },
];

/**
 * Reads the values per 100 g (or ml) from Picnic's "Voedingswaarde" text: a markdown table ("| Energie | 1046 kJ
 * / 250 kcal |") or plain lines ("Vetten: 9,5 g"). With several columns the "per 100" one wins, else the first number.
 * Null when there is no energy value.
 */
export function parsePicnicNutrition(text: string): { per100: Nutrients; unit: 'g' | 'ml' } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\|?\s*:?-{2,}/.test(l));
  // A table header tells which column is per 100.
  let column = -1;
  let unit: 'g' | 'ml' = /100\s*ml/i.test(text) ? 'ml' : 'g';
  const cells = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  for (const l of lines) {
    if (!l.includes('|')) continue;
    const cs = cells(l);
    const i = cs.findIndex((c) => /per\s*100/i.test(c));
    if (i > 0) {
      column = i;
      if (/100\s*ml/i.test(cs[i])) unit = 'ml';
      break;
    }
  }
  const found: Partial<Record<(typeof LABELS)[number]['key'], number>> = {};
  for (const l of lines) {
    let label: string;
    let value: string;
    if (l.includes('|')) {
      const cs = cells(l);
      if (cs.length < 2) continue;
      label = cs[0];
      value = column > 0 && cs[column] !== undefined ? cs[column] : cs.slice(1).find((c) => /\d/.test(c)) ?? '';
    } else {
      const m = /^(.*?[a-zA-Zë)])\s*[:\s]\s*(<?\s*\d.*)$/.exec(l);
      if (!m) continue;
      label = m[1];
      value = m[2];
    }
    const lower = label.toLowerCase();
    const hit = LABELS.find((x) => x.test.test(lower));
    if (!hit || found[hit.key] !== undefined) continue;
    if (hit.key === 'kcal') {
      const kcal = /(\d+(?:[.,]\d+)?)\s*kcal/i.exec(value);
      const kj = /(\d+(?:[.,]\d+)?)\s*kj/i.exec(value);
      if (kcal) found.kcal = number(kcal[1])!;
      else if (kj) found.kj = number(kj[1])!;
      else if (/kj/i.test(lower)) found.kj = number(value) ?? undefined;
      else {
        const v = number(value);
        if (v !== null) found.kcal = v;
      }
      continue;
    }
    const v = number(value);
    if (v === null) continue;
    // Sodium is often in mg.
    found[hit.key] = hit.key === 'sodium' && /mg/i.test(value) ? v / 1000 : v;
  }
  const kcal = found.kcal ?? (found.kj !== undefined ? found.kj / KJ_PER_KCAL : undefined);
  if (kcal === undefined) return null;
  const salt = found.salt ?? (found.sodium !== undefined ? found.sodium * 2.5 : null);
  return {
    unit,
    per100: {
      kcal: round(kcal, 1),
      protein: found.protein ?? null,
      carbs: found.carbs ?? null,
      sugars: found.sugars ?? null,
      fat: found.fat ?? null,
      satFat: found.satFat ?? null,
      fibre: found.fibre ?? null,
      salt: salt === null ? null : round(salt, 3),
    },
  };
}

/** "500 g" → one pack of 500 g; "6 x 300 ml" → one of 300 ml; anything else → no serving. */
export function servingFrom(unitQuantity: string): { label: string; grams: number; unit: 'g' | 'ml' } | null {
  const m = /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gram|ml|cl|l|liter)\b/i.exec(unitQuantity);
  if (!m) return null;
  const n = Number(m[2].replace(',', '.'));
  const u = m[3].toLowerCase();
  const grams = u === 'kg' || u === 'l' || u === 'liter' ? n * 1000 : u === 'cl' ? n * 10 : n;
  const unit = u === 'ml' || u === 'cl' || u === 'l' || u === 'liter' ? 'ml' : 'g';
  if (!(grams > 0 && grams <= 5000)) return null;
  return { label: m[1] ? `1 × ${m[2]} ${m[3]}` : unitQuantity.trim(), grams, unit };
}

// ---------- Link, recent articles, import ----------

interface Stored {
  authKey: string;
  linkedAt: string;
}

let pending2fa: string | null = null;
let articleCache: { at: number; articles: Omit<PicnicArticle, 'productId'>[] } | null = null;

async function stored(): Promise<Stored | null> {
  const raw = await getSetting('picnic');
  try {
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

async function store(authKey: string) {
  pending2fa = null;
  articleCache = null;
  await run(`INSERT INTO settings (key, value) VALUES ('picnic', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [
    JSON.stringify({ authKey, linkedAt: new Date().toISOString() } satisfies Stored),
  ]);
}

export async function picnicStatus(): Promise<PicnicStatus> {
  const s = await stored();
  return { linked: Boolean(s), linkedAt: s?.linkedAt ?? null, awaiting2fa: pending2fa !== null };
}

const failed = (err: unknown) =>
  new UserError(
    502,
    `Picnic answered with an error: ${String((err as Error)?.message ?? err).slice(0, 160)}`,
    `Picnic gaf een fout: ${String((err as Error)?.message ?? err).slice(0, 160)}`,
  );

export async function picnicLogin(email: string, password: string): Promise<PicnicStatus> {
  let r: { authKey: string; needs2fa: boolean };
  try {
    r = await api.login(email, password);
  } catch (err) {
    throw new UserError(401, 'Picnic did not accept this e-mail address and password.', 'Picnic accepteert dit e-mailadres en wachtwoord niet.');
  }
  if (r.needs2fa) pending2fa = r.authKey;
  else await store(r.authKey);
  return picnicStatus();
}

export async function picnicSend2fa(channel: 'SMS' | 'EMAIL'): Promise<void> {
  if (!pending2fa) throw new UserError(400, 'Log in to Picnic first.', 'Log eerst in bij Picnic.');
  try {
    await api.send2fa(pending2fa, channel);
  } catch (err) {
    throw failed(err);
  }
}

export async function picnicVerify2fa(code: string): Promise<PicnicStatus> {
  if (!pending2fa) throw new UserError(400, 'Log in to Picnic first.', 'Log eerst in bij Picnic.');
  let key: string;
  try {
    key = await api.verify2fa(pending2fa, code);
  } catch {
    throw new UserError(400, 'That code is not right, or it expired.', 'Die code klopt niet, of is verlopen.');
  }
  await store(key);
  return picnicStatus();
}

export async function picnicUnlink(): Promise<void> {
  pending2fa = null;
  articleCache = null;
  await run(`DELETE FROM settings WHERE key = 'picnic'`);
}

/** The stored key, or a clear message; an expired key unlinks, so the profile asks to log in again. */
async function authKey(): Promise<string> {
  const s = await stored();
  if (!s) throw new UserError(400, 'Link your Picnic account first (Profile → Picnic).', 'Koppel eerst je Picnic-account (Profiel → Picnic).');
  return s.authKey;
}

async function withAuth<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const key = await authKey();
  try {
    return await fn(key);
  } catch (err) {
    if (err instanceof PicnicAuthError) {
      await picnicUnlink();
      throw new UserError(401, 'Picnic logged you out. Link your account again under Profile → Picnic.', 'Picnic heeft je uitgelogd. Koppel je account opnieuw onder Profiel → Picnic.');
    }
    throw err instanceof UserError ? err : failed(err);
  }
}

/** Products from your last five deliveries, most recent first; cached for ten minutes. */
export async function picnicArticles(): Promise<PicnicArticle[]> {
  if (!articleCache || Date.now() - articleCache.at > 600_000) {
    const deliveries = await withAuth((key) => api.deliveries(key, 5));
    const byId = new Map<string, Omit<PicnicArticle, 'productId'>>();
    for (const d of deliveries) {
      for (const a of d.articles) {
        const cur = byId.get(a.id);
        if (cur) cur.times += 1;
        else byId.set(a.id, { id: a.id, name: a.name, unitQuantity: a.unitQuantity, times: 1, lastDelivered: d.deliveredAt });
      }
    }
    articleCache = { at: Date.now(), articles: [...byId.values()] };
  }
  const rows = await all<{ id: number; source_id: string }>(`SELECT id, source_id FROM products WHERE source = 'picnic' AND source_id = ANY($1::text[])`, [
    articleCache.articles.map((a) => a.id),
  ]);
  const known = new Map(rows.map((r) => [r.source_id, r.id]));
  return articleCache.articles.map((a) => ({ ...a, productId: known.get(a.id) ?? null }));
}

/**
 * Reads one Picnic product: with its nutrition values it becomes a product here (refreshed after 30 days); without
 * them you get a draft with Picnic's text, to complete as your own product.
 */
export async function picnicImport(id: string, lang: Lang): Promise<PicnicImport> {
  if (!/^[\w-]{1,40}$/.test(id)) throw new UserError(400, 'Unknown Picnic product', 'Onbekend Picnic-product');
  const existing = await one<{ id: number; fetched_at: string }>(`SELECT id, fetched_at FROM products WHERE source = 'picnic' AND source_id = $1`, [id]);
  if (existing && Date.now() - Date.parse(existing.fetched_at) < 30 * 86_400_000) return { product: (await getProduct(existing.id, lang))!, draft: null };

  const page = await withAuth((key) => api.product(key, id));
  const section = page.sections.find((s) => /voedingswaarde|nutri/i.test(s.title));
  const parsed = section ? parsePicnicNutrition(section.content) : null;
  const serving = servingFrom(page.unitQuantity);
  const unit = parsed?.unit ?? serving?.unit ?? 'g';
  if (!parsed) return { product: null, draft: { name: page.name, brand: page.brand ?? '', unit, nutritionText: section?.content ?? null } };

  const n = parsed.per100;
  const row = await one<{ id: number }>(
    `INSERT INTO products (source, source_id, name_en, name_nl, brand, unit, kcal, protein, carbs, sugars, fat, sat_fat, fibre, salt, servings, fetched_at, updated_at)
     VALUES ('picnic', $1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
       name_en = excluded.name_en, name_nl = excluded.name_nl, brand = excluded.brand, unit = excluded.unit, kcal = excluded.kcal,
       protein = excluded.protein, carbs = excluded.carbs, sugars = excluded.sugars, fat = excluded.fat, sat_fat = excluded.sat_fat,
       fibre = excluded.fibre, salt = excluded.salt, servings = excluded.servings, fetched_at = now(), updated_at = now()
     RETURNING id`,
    [id, page.name, page.brand ?? '', unit, n.kcal, n.protein, n.carbs, n.sugars, n.fat, n.satFat, n.fibre, n.salt, JSON.stringify(serving ? [{ label: serving.label, grams: serving.grams }] : [])],
  );
  return { product: (await getProduct(row!.id, lang))!, draft: null };
}
