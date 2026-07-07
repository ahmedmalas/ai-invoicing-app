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

    const query = z
      .object({
        eventKey: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const options = {
      ...(query.eventKey !== undefined ? { eventKey: query.eventKey } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    };

    return {
      events: app.db.getTimelineForEntity(params.entityType, params.entityId, options),
    };
  });
};
