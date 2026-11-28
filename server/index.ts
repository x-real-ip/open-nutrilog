import { buildApp } from './app.ts';
import { initAuth } from './auth.ts';
import { config } from './config.ts';
import { closeDb, openDb } from './db.ts';
import { aiConfigured, getAiSettings, loadAiSettings } from './services/aiSettings.ts';
import { syncProfile } from './services/bodyWeight.ts';
import { today } from './services/days.ts';
import { startReminders } from './services/reminders.ts';
import { flushOutbox, importStrengthWeightsOnce, linked, startOutboxRetry } from './services/strength.ts';

await openDb(undefined, { migrate: config.migrateOnStart });
await initAuth();
await loadAiSettings();
const app = await buildApp({ logger: { level: config.logLevel } });

app.log.info(`AI: ${aiConfigured() ? `${getAiSettings().provider} (${getAiSettings().model})` : 'not configured'}; auth: ${config.auth.mode}; time zone: ${config.timeZone}`);

await app.listen({ port: config.port, host: config.host });

// Push reminders (meals, weigh-in, the day's summary), checked every minute.
startReminders((msg) => app.log.warn(msg));

// The link with Open Strength: bring its weigh-ins over once, then send what is queued, now and every minute.
if (linked()) {
  app.log.info(`Open Strength: ${config.integration.strengthUrl}`);
  void (async () => {
    if ((await importStrengthWeightsOnce(today(config.timeZone))) > 0) await syncProfile();
    await flushOutbox();
  })().catch(() => {});
  startOutboxRetry();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    // Stop accepting requests, let in-flight ones finish, then close the pool.
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
