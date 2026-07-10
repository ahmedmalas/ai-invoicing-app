import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createUserSchema } from '../domain/users/validation.js';
import { parsePagination } from './pagination.js';

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.post('/users', async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const user = await app.db.createUser(body);
    return reply.code(201).send(user);
  });

  app.get('/users/:userId', async (request, reply) => {
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const user = await app.db.getUserById(params.userId);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }
    return user;
  });

  app.get('/users', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      users: await app.db.listUsers(pagination),
    };
  });

  app.delete('/users/:userId', async (request, reply) => {
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    await app.db.deleteUser(params.userId);
    return reply.code(204).send();
  });
};
