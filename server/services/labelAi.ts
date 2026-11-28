// Reading the nutrition table on a pack from a photo, to fill in a new product. The AI only copies what the label
// says (per 100 g or ml); the server checks the numbers, and you see them in the product form and save them
// yourself. Nothing is stored here and the photo is not kept.
import { z } from 'zod';
import type { LabelReading } from '../../shared/types.ts';
import { round } from '../../shared/nutrition.ts';
import { AI_LANGUAGE, UserError, type Lang } from '../i18n.ts';
import { AiError, complete, extractJson } from './ai.ts';
import { imagePart } from './mealAi.ts';

const value = z.coerce.number().min(0).max(1000).nullable().optional();

export const labelSchema = z.object({
  found: z.boolean(),
  name: z.string().trim().max(160).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  unit: z.enum(['g', 'ml']).default('g'),
  per100: z
    .object({
      kcal: value,
      kj: z.coerce.number().min(0).max(4200).nullable().optional(),
      protein: value,
      carbs: value,
      sugars: value,
      fat: value,
      satFat: value,
      fibre: value,
      salt: value,
      sodium: value,
    })
    .default({}),
  serving: z
    .object({ label: z.string().trim().min(1).max(60), grams: z.coerce.number().positive().max(5000) })
    .nullable()
    .optional(),
});

function systemPrompt(lang: Lang): string {
  return [
    'You read nutrition labels on food packs for a food diary. Reply with exactly one JSON object and nothing else:',
    '{"found":true,"name":"...","brand":"...","unit":"g","per100":{"kcal":380,"protein":8.5,"carbs":62,"sugars":21,"fat":9.8,"satFat":4.1,"fibre":6.2,"salt":0.4},"serving":{"label":"1 bar","grams":35}}',
    '- Copy the numbers from the column per 100 g or per 100 ml. Do not estimate or round; a value that is not on the label is null.',
    '- "unit": "ml" when the label gives values per 100 ml, else "g".',
    '- Energy: kcal. If the label shows only kJ, give "kj" instead of "kcal". "<0.5 g" or "traces" is 0.',
    '- Salt in grams; if only sodium is given, give "sodium" (in grams) instead of "salt".',
    '- If the label only has values per serving, divide them to per 100 using the serving size.',
    `- "serving": a portion the label names with its size (e.g. "1 bar" of 35 g), or null. Write its label in ${AI_LANGUAGE[lang]}.`,
    '- "name" and "brand": only when they are readable on the photo, else null.',
    '- If there is no nutrition table on the photo, reply {"found":false}.',
  ].join('\n');
}

const d1 = (n: number | null | undefined) => (n === null || n === undefined ? null : round(n, 1));

/** The label's values per 100, checked; kJ and sodium turned into kcal and salt. */
export function toReading(raw: z.infer<typeof labelSchema>): LabelReading | null {
  const p = raw.per100;
  const kcal = p.kcal ?? (p.kj !== null && p.kj !== undefined ? p.kj / 4.184 : null);
  if (!raw.found || kcal === null || kcal === undefined || kcal > 1000) return null;
  const salt = p.salt ?? (p.sodium !== null && p.sodium !== undefined ? p.sodium * 2.5 : null);
  return {
    name: raw.name || null,
    brand: raw.brand || null,
    unit: raw.unit,
    per100: {
      kcal: Math.round(kcal),
      protein: d1(p.protein),
      carbs: d1(p.carbs),
      sugars: d1(p.sugars),
      fat: d1(p.fat),
      satFat: d1(p.satFat),
      fibre: d1(p.fibre),
      salt: salt === null || salt === undefined ? null : round(salt, 2),
    },
    serving: raw.serving ? { label: raw.serving.label, grams: round(raw.serving.grams, 1) } : null,
  };
}

/** Reads the nutrition table on a photo (resized in the browser). */
export async function readLabel(dataUrl: string, lang: Lang): Promise<{ label: LabelReading }> {
  const image = imagePart(dataUrl);
  const reply = await complete({
    feature: 'label',
    system: systemPrompt(lang),
    messages: [{ role: 'user', content: [image, { type: 'text', text: lang === 'nl' ? 'Lees de voedingswaarden.' : 'Read the nutrition values.' }] }],
    maxTokens: 1500,
    json: true,
  });
  const parsed = labelSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new AiError({ en: 'The AI answer could not be read. Try again.', nl: 'Het antwoord van de AI was onleesbaar. Probeer het opnieuw.' });
  const label = toReading(parsed.data);
  if (!label)
    throw new UserError(
      422,
      'No nutrition table found on the photo. Take it straight on, close to the table, with enough light.',
      'Geen voedingswaardetabel gevonden op de foto. Fotografeer de tabel recht van voren, van dichtbij en met genoeg licht.',
    );
  return { label };
}
