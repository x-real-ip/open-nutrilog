// Small helpers for products and diary entries on the client.
import type { DiaryEntry, EntryInput, Product, ProductSource } from '@shared/types.ts';
import { quantityOf, scale, type Nutrients } from '@shared/nutrition.ts';
import { grams, num } from './format.ts';
import { t } from './i18n.ts';

/** What the diary shows for an entry until the server has confirmed it; the same maths as the server. */
export function previewEntry(id: string, input: EntryInput, product: Product | null, createdAt = new Date().toISOString()): DiaryEntry {
  if (input.unit === 'kcal' || !product) {
    const q = input.quick;
    const nutrients: Nutrients = { kcal: q?.kcal ?? 0, protein: q?.protein ?? null, carbs: q?.carbs ?? null, fat: q?.fat ?? null, sugars: null, satFat: null, fibre: null, salt: null };
    return { ...input, id, name: q?.name || t('Quick add', 'Snel toevoegen'), brand: '', source: null, quantity: 0, nutrients, aiEstimate: false, createdAt };
  }
  const quantity = quantityOf(input.amount, input.unit, input.servingLabel, product.servings) ?? 0;
  return {
    ...input,
    id,
    name: product.name,
    brand: product.brand,
    source: product.source,
    quantity,
    nutrients: scale(product.per100, quantity),
    aiEstimate: false,
    createdAt,
  };
}

/** "150 g", "2 × 1 slice (70 g)", "250 kcal". */
export function amountLabel(e: Pick<DiaryEntry, 'amount' | 'unit' | 'servingLabel' | 'quantity'>, base: string = 'g'): string {
  if (e.unit === 'kcal') return '';
  if (e.unit === 'serving') return `${num(e.amount, 2)} × ${e.servingLabel ?? ''} (${num(e.quantity, 0)} ${base})`;
  return `${num(e.amount, 1)} ${e.unit}`;
}

export function sourceLabel(source: ProductSource | null): string {
  switch (source) {
    case 'off':
      return 'OFF';
    case 'nevo':
      return 'NEVO';
    case 'custom':
      return t('Mine', 'Eigen');
    default:
      return '';
  }
}

/** "P 12 g · C 40 g · F 3 g" with unknown values left out. */
export function macroLine(n: Nutrients): string {
  const parts: string[] = [];
  if (n.protein !== null) parts.push(`${t('P', 'E')} ${grams(n.protein)}`);
  if (n.carbs !== null) parts.push(`${t('C', 'K')} ${grams(n.carbs)}`);
  if (n.fat !== null) parts.push(`${t('F', 'V')} ${grams(n.fat)}`);
  return parts.join(' · ');
}

/** Parses a number typed with either a comma or a point. */
export function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
}
