import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const reportQuerySchema = z
  .object({
    from: isoDateSchema.refine(isValidIsoCalendarDate, 'from must be a valid ISO date').optional(),
    to: isoDateSchema.refine(isValidIsoCalendarDate, 'to must be a valid ISO date').optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be less than or equal to to',
    path: ['from'],
  });

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reports/read-model', async (request, reply) => {
    const query = reportQuerySchema.parse(request.query);
    const report = app.db.getReportingReadModel({
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    });
    return reply.code(200).send(report);
  });
};
