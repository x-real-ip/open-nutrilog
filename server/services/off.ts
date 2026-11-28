// Open Food Facts (ODbL). Only the server talks to OFF, never the browser: with a descriptive User-Agent, only the
// fields we need, throttled below OFF's limits (100 product reads and 10 searches per minute per IP in their docs),
// and every product cached in Postgres. Our own products are never sent to OFF.
import type { BaseUnit, Nutrients, Serving } from '../../shared/nutrition.ts';
import { KJ_PER_KCAL, round } from '../../shared/nutrition.ts';
import { config } from '../config.ts';
import { RateLimiter } from './throttle.ts';

/** What we keep of an OFF product. */
export interface OffProduct {
  barcode: string;
  nameEn: string;
  nameNl: string;
  brand: string;
  unit: BaseUnit;
  per100: Nutrients;
  extra: Record<string, { value: number; unit: string }>;
  servings: Serving[];
}

export const OFF_FIELDS = [
  'code',
  'lang',
  'product_name',
  'product_name_en',
  'product_name_nl',
  'generic_name',
  'brands',
  'quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutrition_data_per',
  'nutriments',
] as const;

const MAIN_NUTRIMENTS = new Set([
  'energy',
  'energy-kcal',
  'energy-kj',
  'proteins',
  'carbohydrates',
  'sugars',
  'fat',
  'saturated-fat',
  'fiber',
  'salt',
]);

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** "100 ml", "1,5 l", "33cl" → ml; everything else (g, kg, nothing) → g. */
function baseUnit(p: Record<string, unknown>): BaseUnit {
  const declared = text(p.product_quantity_unit).toLowerCase();
  if (declared === 'ml') return 'ml';
  if (declared === 'g') return 'g';
  return /\d\s*(ml|cl|dl|l)\b/i.test(text(p.quantity)) ? 'ml' : 'g';
}

/**
 * Maps an OFF product to ours. Returns null when there is no usable energy value: a product without kcal can't be
 * logged. Handles kJ-only labels, salt given as sodium, values only per serving, and missing names.
 */
export function mapOff(p: Record<string, any> | null | undefined): OffProduct | null {
  if (!p || typeof p !== 'object') return null;
  const barcode = text(p.code);
  const n: Record<string, unknown> = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {};

  // Values per 100 g/ml; when only per-serving values exist, convert with the serving size.
  const servingQty = num(p.serving_quantity);
  const per100 = (key: string): number | null => {
    const v = num(n[`${key}_100g`]);
    if (v !== null) return round(v, 3);
    const s = num(n[`${key}_serving`]);
    return s !== null && servingQty ? round((s / servingQty) * 100, 3) : null;
  };

  let kcal = per100('energy-kcal');
  if (kcal === null) {
    const kj = per100('energy-kj') ?? per100('energy');
    if (kj !== null) kcal = kj / KJ_PER_KCAL;
  }
  if (kcal === null) return null;

  let salt = per100('salt');
  const sodium = per100('sodium');
  if (salt === null && sodium !== null) salt = sodium * 2.5;

  const nutrients: Nutrients = {
    kcal: round(kcal, 1),
    protein: per100('proteins'),
    carbs: per100('carbohydrates'),
    sugars: per100('sugars'),
    fat: per100('fat'),
    satFat: per100('saturated-fat'),
    fibre: per100('fiber'),
    salt: salt === null ? null : round(salt, 3),
  };

  // Everything else per 100, with its unit, for later use.
  const extra: OffProduct['extra'] = {};
  for (const key of Object.keys(n)) {
    if (!key.endsWith('_100g')) continue;
    const name = key.slice(0, -5);
    if (MAIN_NUTRIMENTS.has(name) || name.startsWith('energy') || name.includes('nutrition-score') || name.includes('fruits-vegetables')) continue;
    const value = num(n[key]);
    if (value === null) continue;
    extra[name] = { value, unit: text(n[`${name}_unit`]) || 'g' };
  }

  // Dutch name where OFF has one; otherwise the main name in both languages.
  const main = text(p.product_name) || text(p.generic_name);
  const lang = text(p.lang);
  const nameNl = text(p.product_name_nl) || (lang === 'nl' ? main : '') || main;
  const nameEn = text(p.product_name_en) || (lang === 'en' ? main : '') || main || nameNl;
  const brand = text(p.brands).split(',')[0]?.trim() ?? '';

  const servings: Serving[] = [];
  const servingLabel = text(p.serving_size);
  if (servingQty && servingQty > 0 && servingQty < 5000) servings.push({ label: servingLabel || `${servingQty} ${baseUnit(p)}`, grams: servingQty });

  return {
    barcode,
    nameEn: nameEn || nameNl || barcode,
    nameNl: nameNl || nameEn || barcode,
    brand,
    unit: baseUnit(p),
    per100: nutrients,
    extra,
    servings,
  };
}

/** A barcode as OFF stores it: digits only, 8 to 14 long. */
export function normalizeBarcode(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

export const productLimiter = new RateLimiter(60);
export const searchLimiter = new RateLimiter(8);

export type OffResult = { status: 'found'; product: OffProduct } | { status: 'not_found' } | { status: 'unusable' } | { status: 'throttled' } | { status: 'error'; message: string };

export function userAgent(): string {
  return `open-nutrilog/${config.version} (+https://github.com/x-real-ip/open-nutrilog)`;
}

/** Fetches one product by barcode from the OFF API (v2), within the throttle. Never throws. */
export async function fetchOffProduct(barcode: string): Promise<OffResult> {
  if (!productLimiter.tryTake()) return { status: 'throttled' };
  const url = `${config.off.baseUrl}/api/v2/product/${encodeURIComponent(barcode)}?fields=${OFF_FIELDS.join(',')}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': userAgent(), accept: 'application/json' }, signal: AbortSignal.timeout(config.off.timeoutMs) });
    if (res.status === 404) return { status: 'not_found' };
    if (res.status === 429 || res.status === 503) return { status: 'throttled' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
    if (body.status !== 1 || !body.product) return { status: 'not_found' };
    const product = mapOff({ code: barcode, ...body.product });
    return product ? { status: 'found', product: { ...product, barcode } } : { status: 'unusable' };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

export type OffSearchResult = { status: 'ok'; products: OffProduct[] } | { status: 'throttled' } | { status: 'error'; message: string };

/**
 * Live text search at OFF: only when you ask for it (the local search comes first), and within 8 searches a minute
 * (OFF allows 10). Products without usable energy are left out. Never throws.
 */
export async function searchOff(query: string): Promise<OffSearchResult> {
  if (!searchLimiter.tryTake()) return { status: 'throttled' };
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '24',
    fields: OFF_FIELDS.join(','),
  });
  try {
    const res = await fetch(`${config.off.baseUrl}/cgi/search.pl?${params}`, {
      headers: { 'user-agent': userAgent(), accept: 'application/json' },
      signal: AbortSignal.timeout(config.off.timeoutMs),
    });
    if (res.status === 429 || res.status === 503) return { status: 'throttled' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const body = (await res.json()) as { products?: Record<string, unknown>[] };
    const products = (body.products ?? []).flatMap((p) => {
      const mapped = mapOff(p);
      const code = mapped && normalizeBarcode(mapped.barcode);
      return mapped && code ? [{ ...mapped, barcode: code }] : [];
    });
    return { status: 'ok', products };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}
