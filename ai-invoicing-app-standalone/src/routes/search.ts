import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request, reply) => {
    const query = z
      .object({
        q: z.string().min(1),
      })
      .parse(request.query);

    const results = app.db.search(query.q);
    return reply.code(200).send(results);
  });
};
