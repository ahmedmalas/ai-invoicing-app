import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1),
});

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});

export const removeTeamMemberParamsSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const deleteTeamParamsSchema = z.object({
  teamId: z.string().uuid(),
});
