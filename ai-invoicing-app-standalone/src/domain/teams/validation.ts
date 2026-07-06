import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1),
});

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});
