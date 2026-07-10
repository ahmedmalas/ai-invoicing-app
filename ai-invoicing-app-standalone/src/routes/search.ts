import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const searchEntityTypeSchema = z.enum([
  'customers',
  'suppliers',
  'invoices',
  'creditNotes',
  'customerPayments',
  'purchaseOrders',
  'supplierBills',
  'supplierPayments',
  'documents',
  'jobs',
]);

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request, reply) => {
    const query = z
      .object({
        q: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        entityTypes: z.string().optional(),
      })
      .parse(request.query);

    const entityTypes = query.entityTypes
      ? query.entityTypes.split(',').map((item) => searchEntityTypeSchema.parse(item.trim()))
      : undefined;
    const results = await app.db.search(query.q, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(entityTypes ? { entityTypes } : {}),
    });
    return reply.code(200).send(results);
  });
};
