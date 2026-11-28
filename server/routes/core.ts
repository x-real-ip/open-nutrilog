import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppInfo } from '../../shared/types.ts';
import { checkPassword, clearFailures, loginAllowed, logout, oidcCallback, oidcLoginRedirect, passwordLogin, recordFailure } from '../auth.ts';
import { config } from '../config.ts';
import { langOf, UserError } from '../i18n.ts';
import { databaseReady } from '../db.ts';
import { aiConfigured, getAiSettings } from '../services/aiSettings.ts';
import { picnicStatus } from '../services/picnic.ts';
import { noteProfileWeight } from '../services/bodyWeight.ts';
import { today } from '../services/days.ts';
import { getProfile, saveProfile, timeZoneOf } from '../services/profile.ts';

export async function coreRoutes(app: FastifyInstance) {
  // Kubernetes readiness and liveness probe. Outside /api so it never needs auth.
  // No error details: they could contain connection settings.
  app.get('/healthz', async (_req, reply) => {
    if (await databaseReady()) return { status: 'ok', database: 'ok' };
    return reply.code(503).send({ status: 'error', database: 'error' });
  });

  app.get('/api/info', async (req): Promise<AppInfo> => {
    const profile = await getProfile().catch(() => null);
    const timeZone = timeZoneOf(profile);
    return {
      aiConfigured: aiConfigured(),
      picnicLinked: (await picnicStatus()).linked,
      aiProvider: getAiSettings().provider,
      aiModel: getAiSettings().model,
      authMode: config.auth.mode,
      authRequired: config.auth.mode !== 'none',
      authenticated: Boolean(req.user),
      user: req.user ?? null,
      oidcProviderName: config.auth.oidcProviderName,
      version: config.version,
      language: langOf(profile),
      timeZone,
      today: today(timeZone),
    };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (config.auth.mode !== 'password') throw new UserError(400, 'Password login is turned off', 'Inloggen met een wachtwoord staat uit');
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!loginAllowed(req.ip)) throw new UserError(429, 'Too many attempts. Try again in 15 minutes.', 'Te veel pogingen. Probeer het over 15 minuten opnieuw.');
    if (!checkPassword(password)) {
      recordFailure(req.ip);
      throw new UserError(401, 'Wrong password', 'Verkeerd wachtwoord');
    }
    clearFailures(req.ip);
    passwordLogin(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/oidc/login', async (req, reply) => {
    if (config.auth.mode !== 'oidc') return reply.code(404).send({ error: 'OIDC is not enabled' });
    return oidcLoginRedirect(req, reply);
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    if (config.auth.mode !== 'oidc') return reply.code(404).send({ error: 'OIDC is not enabled' });
    return oidcCallback(req, reply);
  });

  app.post('/api/auth/logout', async (req, reply) => ({ ok: true, redirect: await logout(req, reply) }));

  app.get('/api/profile', async () => ({ profile: await getProfile() }));
  app.put('/api/profile', async (req) => {
    const before = await getProfile();
    const profile = await saveProfile(req.body);
    await noteProfileWeight(before, profile);
    return { profile };
  });
}
