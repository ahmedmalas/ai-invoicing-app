import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const preferenceSchema = z.object({
  value: z.record(z.string(), z.unknown()),
});

export const preferenceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/preferences/:category', async (request, reply) => {
    const params = z
      .object({
        category: z.enum(['branding', 'invoice']),
      })
      .parse(request.params);

    const body = preferenceSchema.parse(request.body);
    app.db.upsertPreference(params.category, body.value);
    return reply.code(201).send({ category: params.category, value: body.value });
  });

  app.get('/preferences/:category', async (request, reply) => {
    const params = z
      .object({
        category: z.enum(['branding', 'invoice']),
      })
      .parse(request.params);

    const value = app.db.getPreference(params.category);
    if (!value) {
      return reply.code(404).send({ message: 'Preference not found' });
    }

    return { category: params.category, value };
  });
};
