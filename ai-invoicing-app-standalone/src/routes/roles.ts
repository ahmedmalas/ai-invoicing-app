import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createRoleSchema } from '../domain/users/validation.js';
import { paginateArray, parsePagination } from './pagination.js';

export const roleRoutes: FastifyPluginAsync = async (app) => {
  app.post('/roles', async (request, reply) => {
    const body = createRoleSchema.parse(request.body);
    const role = app.db.createRole(body);
    return reply.code(201).send(role);
  });

  app.get('/roles/:roleId', async (request, reply) => {
    const params = z.object({ roleId: z.string().uuid() }).parse(request.params);
    const role = app.db.getRoleById(params.roleId);
    if (!role) {
      return reply.code(404).send({ message: 'Role not found' });
    }
    return role;
  });

  app.get('/roles', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      roles: paginateArray(app.db.listRoles(), pagination),
    };
  });
};
