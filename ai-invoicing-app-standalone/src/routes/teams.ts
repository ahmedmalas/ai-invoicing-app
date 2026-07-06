import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { addTeamMemberSchema, createTeamSchema } from '../domain/teams/validation.js';

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

  app.get('/teams', async () => {
    return {
      teams: app.db.listTeams(),
    };
  });

  app.post('/teams/:teamId/members', async (request, reply) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    const body = addTeamMemberSchema.parse(request.body);
    const membership = app.db.addTeamMember(params.teamId, body.userId);
    return reply.code(201).send(membership);
  });

  app.get('/teams/:teamId/members', async (request) => {
    const params = z.object({ teamId: z.string().uuid() }).parse(request.params);
    return {
      members: app.db.listTeamMembers(params.teamId),
    };
  });
};
