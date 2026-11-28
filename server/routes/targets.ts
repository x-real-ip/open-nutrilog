import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteBodyWeight, listBodyWeights, logBodyWeight } from '../services/bodyWeight.ts';
import { progress, setMark, targetFor } from '../services/dayTargets.ts';
import { changeFast, deleteFast, endFast, getFasting, startFast } from '../services/fasting.ts';
import { DAY_PATTERN } from '../services/days.ts';
import { getProfile } from '../services/profile.ts';
import { weekReport } from '../services/weekReport.ts';
import { langOf } from '../i18n.ts';

/** Targets, day marks, body weight and progress. */
export async function targetRoutes(app: FastifyInstance) {
  app.get('/api/targets/:day', async (req) => {
    const { day } = z.object({ day: z.string() }).parse(req.params);
    return targetFor(day);
  });

  // "Training today" (also before the workout), "not a training day", and "this day is incomplete".
  app.put('/api/days/:day/mark', async (req) => {
    const { day } = z.object({ day: z.string() }).parse(req.params);
    await setMark(day, req.body);
    return targetFor(day);
  });

  app.get('/api/body-weights', async () => ({ entries: await listBodyWeights() }));
  app.post('/api/body-weights', async (req) => ({ entries: await logBodyWeight(req.body) }));
  app.delete('/api/body-weights/:id', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    return { entries: await deleteBodyWeight(id) };
  });

  // Fasting: one fast runs at a time; a start or end can be set back up to 72 hours.
  app.get('/api/fasting', async () => getFasting());
  app.post('/api/fasting/start', async (req) => startFast(req.body));
  app.put('/api/fasting/current', async (req) => changeFast(req.body));
  app.post('/api/fasting/end', async (req) => endFast(req.body));
  app.delete('/api/fasting/:id', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return deleteFast(id);
  });

  // The week that holds `day` (Monday to Sunday); without it, last week.
  app.get('/api/week-report', async (req) => {
    const { day } = z.object({ day: z.string().regex(DAY_PATTERN).optional() }).parse(req.query);
    return weekReport(day, langOf(await getProfile()));
  });

  app.get('/api/progress', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(366).default(56) }).parse(req.query);
    return progress(days);
  });
}
