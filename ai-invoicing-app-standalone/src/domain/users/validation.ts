import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z.string().min(1),
  canBeAssigned: z.boolean().optional(),
  canManageAssignments: z.boolean().optional(),
});

export const createUserSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});
