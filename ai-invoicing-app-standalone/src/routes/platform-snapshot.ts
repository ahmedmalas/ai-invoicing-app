import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const restorePayloadSchema = z.object({
  snapshot: z.unknown(),
});

export const platformSnapshotRoutes: FastifyPluginAsync = async (app) => {
  app.get('/platform/backup', async () => {
    return {
      snapshot: await app.db.exportPlatformSnapshot(),
    };
  });

  app.post('/platform/restore', async (request, reply) => {
    const body = restorePayloadSchema.parse(request.body);
    await app.db.restorePlatformSnapshot(body.snapshot);
    return reply.code(204).send();
  });
};
