import type { FastifyInstance } from 'fastify';
import { exportJson, importJson } from '../services/dataExport.ts';
import { today } from '../services/days.ts';
import { getProfile, timeZoneOf } from '../services/profile.ts';

export async function dataRoutes(app: FastifyInstance) {
  app.get('/api/export/json', async (_req, reply) => {
    const day = today(timeZoneOf(await getProfile()));
    reply.header('content-disposition', `attachment; filename="open-nutrilog-export-${day}.json"`);
    return exportJson();
  });

  // Replaces all data with the export's.
  app.post('/api/import/json', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    await importJson(req.body);
    return { ok: true };
  });
}
