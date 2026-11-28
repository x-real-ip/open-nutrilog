import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { langOf } from '../i18n.ts';
import { getProfile } from '../services/profile.ts';
import { deleteSubscription, publicKey, pushAll, saveSubscription } from '../services/push.ts';

/** Push notifications for the reminders: this device's subscription, and a test. */
export async function pushRoutes(app: FastifyInstance) {
  app.get('/api/push/key', async () => ({ publicKey: await publicKey() }));

  const subscription = z.object({
    endpoint: z.url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  });

  app.post('/api/push/subscriptions', async (req) => {
    await saveSubscription(subscription.parse(req.body));
    return { ok: true };
  });

  app.delete('/api/push/subscriptions', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await deleteSubscription(endpoint);
    return { ok: true };
  });

  app.post('/api/push/test', async () => {
    const lang = langOf(await getProfile());
    const sent = await pushAll({
      title: 'Open Nutrilog',
      body: lang === 'nl' ? 'Meldingen werken. Je krijgt je herinneringen op de tijden die je kiest.' : 'Notifications work. You get your reminders at the times you pick.',
      tag: 'test',
      url: '/profile',
    });
    return { sent };
  });
}
