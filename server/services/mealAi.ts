// Reading a meal from text ("2 slices of wholemeal bread with cheese and an apple") or a photo. The AI only lists
// foods and amounts; the server matches each food to products here through the normal search, and you confirm
// (or change) every line before anything is logged. Only when nothing matches are the AI's own nutrient estimates
// used, and those entries are marked "AI estimate".
import { z } from 'zod';
import type { MealLine, MealProposal } from '../../shared/types.ts';
import { getPool, run } from '../db.ts';
import { AI_LANGUAGE, UserError, type Lang } from '../i18n.ts';
import { AiError, complete, extractJson, type ImagePart } from './ai.ts';
import { getAiSettings } from './aiSettings.ts';
import { searchProducts } from './products.ts';

const num = (max: number) => z.coerce.number().min(0).max(max);

export const mealItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  grams: z.coerce.number().positive().max(5000),
  estimate: z
    .object({ kcal: num(5000), protein: num(500).nullable().optional(), carbs: num(1000).nullable().optional(), fat: num(500).nullable().optional() })
    .nullable()
    .optional(),
});

export const mealSchema = z.object({ items: z.array(mealItemSchema).max(20) });

function systemPrompt(lang: Lang, photo: boolean): string {
  return [
    'You read meals for a food diary. Reply with exactly one JSON object and nothing else:',
    '{"items":[{"name":"...","grams":120,"estimate":{"kcal":250,"protein":10,"carbs":30,"fat":8}}]}',
    `- "name": one food per item, generic and short, in ${AI_LANGUAGE[lang]}, the way a food database names it (e.g. "volkorenbrood", "Goudse kaas", "appel"). No brands unless the user names one.`,
    '- Split dishes and combinations into their foods: "bread with cheese" is two items.',
    '- "grams": your estimate of the total amount of that food in grams (ml for drinks). Use common Dutch portions: a slice of bread 35 g, a slice of cheese 20 g, an apple 150 g, a glass 200 ml, a cup of coffee 125 ml.',
    '- "estimate": your best estimate of energy (kcal) and protein, carbs and fat (g) for that amount. It is only used when the food is not in the database.',
    photo
      ? '- You see a photo: estimate portions from what is visible (plate size, cutlery). These are guesses; the user corrects them.'
      : '- Use the amounts the user gives; estimate the rest.',
    '- If there is no food, return {"items":[]}.',
  ].join('\n');
}

/** Turns the AI's list into proposal lines: matches from the normal search, best first. */
export async function matchItems(items: z.infer<typeof mealSchema>['items'], lang: Lang, today: string): Promise<MealProposal> {
  const lines: MealLine[] = [];
  for (const item of items) {
    let candidates = await searchProducts(item.name, lang, today, 5);
    // "Goudse kaas 48+" may be found by its first words only.
    if (!candidates.length && item.name.includes(' ')) candidates = await searchProducts(item.name.split(' ').slice(0, 2).join(' '), lang, today, 5);
    const e = item.estimate;
    lines.push({
      name: item.name,
      grams: Math.round(item.grams),
      candidates,
      estimate: e ? { kcal: Math.round(e.kcal), protein: e.protein ?? null, carbs: e.carbs ?? null, fat: e.fat ?? null } : null,
    });
  }
  return { lines };
}

async function read(lang: Lang, today: string, feature: 'parse' | 'photo', content: string | (ImagePart | { type: 'text'; text: string })[]): Promise<MealProposal> {
  const reply = await complete({ feature, system: systemPrompt(lang, feature === 'photo'), messages: [{ role: 'user', content }], maxTokens: 4000, json: true });
  const parsed = mealSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new AiError({ en: 'The AI answer could not be read. Try again.', nl: 'Het antwoord van de AI was onleesbaar. Probeer het opnieuw.' });
  return matchItems(parsed.data.items, lang, today);
}

export async function readMealText(text: string, lang: Lang, today: string): Promise<MealProposal> {
  return read(lang, today, 'parse', text.trim().slice(0, 1000));
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** A photo (resized in the browser), optionally with a note. Kept only when the setting says so. */
export async function readMealPhoto(dataUrl: string, note: string, lang: Lang, today: string): Promise<MealProposal> {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new UserError(400, 'That is not a photo the app can read (JPEG, PNG or WebP).', 'Dat is geen foto die de app kan lezen (JPEG, PNG of WebP).');
  const data = m[2];
  if ((data.length * 3) / 4 > 2_500_000) throw new UserError(413, 'The photo is too large.', 'De foto is te groot.');
  const proposal = await read(lang, today, 'photo', [
    { type: 'image', mediaType: m[1] as ImagePart['mediaType'], data },
    { type: 'text', text: note.trim() ? note.trim().slice(0, 500) : lang === 'nl' ? 'Wat staat er op deze foto?' : 'What is on this photo?' },
  ]);
  if (getAiSettings().storePhotos) {
    await run('INSERT INTO meal_photos (day, media_type, data) VALUES ($1, $2, $3)', [today, m[1], Buffer.from(data, 'base64')], getPool());
  }
  return proposal;
}
