import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { supplierSchema } from '../domain/supplier-bills/validation.js';
import { paginateArray, parsePagination } from './pagination.js';

export const supplierRoutes: FastifyPluginAsync = async (app) => {
  app.post('/suppliers', async (request, reply) => {
    const body = supplierSchema.parse(request.body);
    const supplier = app.db.createSupplier(body);
    return reply.code(201).send(supplier);
  });

  app.get('/suppliers', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      suppliers: paginateArray(app.db.listSuppliers(), pagination),
    };
  });

  app.get('/suppliers/:supplierId', async (request, reply) => {
    const params = z.object({ supplierId: z.string().uuid() }).parse(request.params);
    const supplier = app.db.getSupplierById(params.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    return supplier;
  });

  app.delete('/suppliers/:supplierId', async (request, reply) => {
    const params = z.object({ supplierId: z.string().uuid() }).parse(request.params);
    app.db.deleteSupplier(params.supplierId);
    return reply.code(204).send();
  });
};
