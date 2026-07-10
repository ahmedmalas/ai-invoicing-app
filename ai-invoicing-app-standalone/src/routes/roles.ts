import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createRoleSchema } from '../domain/users/validation.js';
import { parsePagination } from './pagination.js';

export const roleRoutes: FastifyPluginAsync = async (app) => {
  app.post('/roles', async (request, reply) => {
    const body = createRoleSchema.parse(request.body);
    const role = await app.db.createRole(body);
    return reply.code(201).send(role);
  });

  app.get('/roles/:roleId', async (request, reply) => {
    const params = z.object({ roleId: z.string().uuid() }).parse(request.params);
    const role = await app.db.getRoleById(params.roleId);
    if (!role) {
      return reply.code(404).send({ message: 'Role not found' });
    }
    return role;
  });

  app.get('/roles', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      roles: await app.db.listRoles(pagination),
    };
  });

  app.delete('/roles/:roleId', async (request, reply) => {
    const params = z.object({ roleId: z.string().uuid() }).parse(request.params);
    await app.db.deleteRole(params.roleId);
    return reply.code(204).send();
  });
};
