import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

export const timelineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/timeline/:entityType/:entityId', async (request) => {
    const params = z
      .object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
      })
      .parse(request.params);

    return {
      events: app.db.getTimelineForEntity(params.entityType, params.entityId),
    };
  });
};
