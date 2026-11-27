// Nutrient arithmetic shared by the server and the PWA, so an entry shows the same numbers while it is still
// queued on the phone as after the server saved it. Pure functions only.

/** The nutrients every product and entry carries. `null` means the source didn't say (not zero). */
export interface Nutrients {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  sugars: number | null;
  fat: number | null;
  satFat: number | null;
  fibre: number | null;
  salt: number | null;
}

export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'sugars', 'fat', 'satFat', 'fibre', 'salt'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** A product is described per 100 g or per 100 ml. */
export type BaseUnit = 'g' | 'ml';

/** A named portion of a product: "1 slice" = 35 g. `grams` is ml for a product measured in ml. */
export interface Serving {
  label: string;
  grams: number;
}

/** How an amount was entered: grams/ml, a number of servings, or (quick add) only energy. */
export type EntryUnit = 'g' | 'ml' | 'serving' | 'kcal';

export const KJ_PER_KCAL = 4.184;

/** Grams (or ml) for an amount in a unit. Null when the serving doesn't exist on the product. */
export function quantityOf(amount: number, unit: EntryUnit, servingLabel: string | null | undefined, servings: Serving[]): number | null {
  if (unit === 'g' || unit === 'ml') return amount;
  if (unit === 'serving') {
    const s = servings.find((x) => x.label === servingLabel);
    return s ? amount * s.grams : null;
  }
  return 0;
}

/** Nutrients for a quantity of a product given per 100. Rounded to what is worth showing. */
export function scale(per100: Nutrients, quantity: number): Nutrients {
  const f = quantity / 100;
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const v = per100[k];
    (out as unknown as Record<string, number | null>)[k] = v === null ? null : round(v * f, k === 'kcal' ? 1 : 2);
  }
  return out;
}

/** Totals of several entries. Unknown values count as zero; the total itself is never null. */
export function sumNutrients(items: Nutrients[]): Record<NutrientKey, number> {
  const total = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
  for (const item of items) for (const k of NUTRIENT_KEYS) total[k] += item[k] ?? 0;
  for (const k of NUTRIENT_KEYS) total[k] = round(total[k], 1);
  return total;
}

export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Energy from the macros (Atwater: 4/4/9, fibre 2), used to sanity-check user input. */
export function kcalFromMacros(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat' | 'fibre'>): number {
  return (n.protein ?? 0) * 4 + (n.carbs ?? 0) * 4 + (n.fat ?? 0) * 9 + (n.fibre ?? 0) * 2;
}
