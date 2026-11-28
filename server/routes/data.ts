import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SourcesInfo } from '../../shared/types.ts';
import { getSetting, one } from '../db.ts';
import { langOf, pick } from '../i18n.ts';
import { exportDiaryCsv, exportJson, importJson } from '../services/dataExport.ts';
import { today } from '../services/days.ts';
import { importNevo, nevoAttribution, nevoStatus } from '../services/nevo.ts';
import { getProfile, timeZoneOf } from '../services/profile.ts';

export async function dataRoutes(app: FastifyInstance) {
  const day = async () => today(timeZoneOf(await getProfile()));

  app.get('/api/export/json', async (_req, reply) => {
    reply.header('content-disposition', `attachment; filename="open-nutrilog-export-${await day()}.json"`);
    return exportJson();
  });

  app.get('/api/export/diary.csv', async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="open-nutrilog-diary-${await day()}.csv"`);
    return exportDiaryCsv();
  });

  // Replaces all data with the export's (NEVO stays).
  app.post('/api/import/json', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    await importJson(req.body);
    return { ok: true };
  });

  // The NEVO file you downloaded from NEVO-online, sent as is (CSV or the .zip it comes in).
  app.register(async (scope) => {
    scope.addContentTypeParser(['application/octet-stream', 'application/zip', 'text/csv', 'text/plain'], { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );
    scope.post('/api/nevo/import', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
      const { filename, version } = z.object({ filename: z.string().max(200).default('nevo.csv'), version: z.string().max(20).optional() }).parse(req.query);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
      return { nevo: await importNevo(body, filename, version) };
    });
  });

  app.get('/api/sources', async (): Promise<SourcesInfo> => {
    const lang = langOf(await getProfile());
    const nevo = await nevoStatus();
    const offCount = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE source = 'off'`))!.n;
    let lastImport: SourcesInfo['off']['lastImport'] = null;
    try {
      const raw = await getSetting('off_import');
      if (raw) {
        const parsed = JSON.parse(raw);
        lastImport = { at: parsed.at, imported: parsed.imported };
      }
    } catch {
      // No import yet, or an unreadable record: only the barcode cache counts.
    }
    return {
      nevo: nevo ? { ...nevo, attribution: pick(nevoAttribution(nevo.version), lang) } : null,
      off: { products: offCount, lastImport },
    };
  });
}
