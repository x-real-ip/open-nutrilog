import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { langOf } from '../i18n.ts';
import { picnicArticles, picnicImport, picnicLogin, picnicSend2fa, picnicStatus, picnicUnlink, picnicVerify2fa } from '../services/picnic.ts';
import { getProfile } from '../services/profile.ts';

/** Picnic (optional, experimental): link your account, list your recent delivered products, read one into a product. */
export async function picnicRoutes(app: FastifyInstance) {
  app.get('/api/picnic', async () => picnicStatus());

  // Your password goes to Picnic only; what is kept is the key Picnic hands out.
  app.post('/api/picnic/login', async (req) => {
    const { email, password } = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }).strict().parse(req.body);
    return picnicLogin(email, password);
  });
  app.post('/api/picnic/2fa/send', async (req) => {
    const { channel } = z.object({ channel: z.enum(['SMS', 'EMAIL']).default('SMS') }).strict().parse(req.body ?? {});
    await picnicSend2fa(channel);
    return { ok: true };
  });
  app.post('/api/picnic/2fa/verify', async (req) => {
    const { code } = z.object({ code: z.string().trim().min(3).max(12) }).strict().parse(req.body);
    return picnicVerify2fa(code);
  });
  app.delete('/api/picnic', async () => {
    await picnicUnlink();
    return picnicStatus();
  });

  app.get('/api/picnic/articles', async () => ({ articles: await picnicArticles() }));
  app.post('/api/picnic/articles/:id/import', async (req) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    return picnicImport(id, langOf(await getProfile()));
  });
}
