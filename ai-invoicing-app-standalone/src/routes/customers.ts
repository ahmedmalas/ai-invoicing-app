import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const customerSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  abnTaxId: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.post('/customers', async (request, reply) => {
    const body = customerSchema.parse(request.body);
    const customer = await app.db.createCustomer(body);
    return reply.code(201).send(customer);
  });

  app.put('/customers/:customerId', async (request) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const body = customerSchema.parse(request.body);
    return await app.db.updateCustomer(params.customerId, body);
  });

  app.get('/customers/:customerId', async (request, reply) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const customer = await app.db.getCustomerById(params.customerId);
    if (!customer) {
      return reply.code(404).send({ message: 'Customer not found' });
    }
    return customer;
  });

  app.delete('/customers/:customerId', async (request, reply) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    await app.db.deleteCustomer(params.customerId);
    return reply.code(204).send();
  });
};
