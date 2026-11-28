import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { langOf } from '../i18n.ts';
import { clearMessages, listMessages, sendMessage, suggestionSchema } from '../services/coach.ts';
import { targetFor } from '../services/dayTargets.ts';
import { today } from '../services/days.ts';
import { readLabel } from '../services/labelAi.ts';
import { readMealPhoto, readMealText } from '../services/mealAi.ts';
import { getProfile, timeZoneOf } from '../services/profile.ts';

/** Meals from text or a photo, the nutrition coach, and what a suggested phase would do to the targets. */
export async function aiRoutes(app: FastifyInstance) {
  const context = async () => {
    const profile = await getProfile();
    return { profile, lang: langOf(profile), today: today(timeZoneOf(profile)) };
  };

  // "2 slices of wholemeal bread with cheese and an apple" → lines matched to products, to confirm before logging.
  app.post('/api/ai/meal/text', async (req) => {
    const { text } = z.object({ text: z.string().trim().min(2).max(1000) }).strict().parse(req.body);
    const { lang, today: day } = await context();
    return readMealText(text, lang, day);
  });

  // The same from a photo (resized in the browser). The photo goes to the AI provider; it is kept only if the setting says so.
  app.post('/api/ai/meal/photo', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { image, note } = z.object({ image: z.string().max(3_500_000), note: z.string().max(500).default('') }).strict().parse(req.body);
    const { lang, today: day } = await context();
    return readMealPhoto(image, note, lang, day);
  });

  // The nutrition table on a pack, to fill in a new product. The photo is not kept.
  app.post('/api/ai/label', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { image } = z.object({ image: z.string().max(3_500_000) }).strict().parse(req.body);
    return readLabel(image, (await context()).lang);
  });

  app.get('/api/coach/messages', async () => ({ messages: await listMessages() }));
  app.post('/api/coach/messages', async (req) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
    await sendMessage(content, (await context()).profile);
    return { messages: await listMessages() };
  });
  app.delete('/api/coach/messages', async () => {
    await clearMessages();
    return { ok: true };
  });

  // What a suggested phase would give, worked out by the target engine; nothing is saved until you confirm in the app.
  app.post('/api/targets/preview', async (req) => {
    const suggestion = suggestionSchema.parse(req.body);
    return targetFor((await context()).today, suggestion);
  });
}
