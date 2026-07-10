import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  addTeamMemberSchema,
  createTeamSchema,
  deleteTeamParamsSchema,
  removeTeamMemberParamsSchema,
  updateTeamMemberRoleSchema,
} from '../domain/teams/validation.js';
import { parsePagination } from './pagination.js';

export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.post('/teams', async (request, reply) => {
    const body = createTeamSchema.parse(request.body);
    const team = app.db.createTeam(body);
    return reply.code(201).send(team);
  });

  app.get('/teams/:teamId', async (request, reply) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const team = app.db.getTeamById(params.teamId);
    if (!team) {
      return reply.code(404).send({ message: 'Team not found' });
    }
    return team;
  });

  app.get('/teams', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      teams: app.db.listTeams(pagination),
    };
  });

  app.post('/teams/:teamId/members', async (request, reply) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const body = addTeamMemberSchema.parse(request.body);
    const actorUserId = request.auth.userId;
    const membership = app.db.addTeamMember(params.teamId, body.userId, body.role, actorUserId);
    return reply.code(201).send(membership);
  });

  app.get('/teams/:teamId/members', async (request) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      members: app.db.listTeamMembers(params.teamId, pagination),
    };
  });

  app.delete('/teams/:teamId/members/:userId', async (request, reply) => {
    const params = removeTeamMemberParamsSchema.parse(request.params);
    const actorUserId = request.auth.userId;
    app.db.removeTeamMember(params.teamId, params.userId, actorUserId);
    return reply.code(204).send();
  });

  app.patch('/teams/:teamId/members/:userId/role', async (request) => {
    const params = removeTeamMemberParamsSchema.parse(request.params);
    const body = updateTeamMemberRoleSchema.parse(request.body);
    const actorUserId = request.auth.userId;
    return app.db.updateTeamMemberRole(params.teamId, params.userId, body.role, actorUserId);
  });

  app.delete('/teams/:teamId', async (request, reply) => {
    const params = deleteTeamParamsSchema.parse(request.params);
    const actorUserId = request.auth.userId;
    app.db.deleteTeam(params.teamId, actorUserId);
    return reply.code(204).send();
  });
};
