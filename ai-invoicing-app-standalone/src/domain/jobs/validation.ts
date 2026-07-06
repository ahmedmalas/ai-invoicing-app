import { z } from 'zod';

export const jobStatusSchema = z.enum([
  'Draft',
  'Scheduled',
  'In Progress',
  'On Hold',
  'Completed',
  'Cancelled',
]);

export const jobPrioritySchema = z.enum(['Low', 'Normal', 'High', 'Urgent']);

export const createJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  customerId: z.string().uuid(),
  status: jobStatusSchema.default('Draft'),
  priority: jobPrioritySchema.default('Normal'),
  scheduledDate: z.string().optional(),
  completedDate: z.string().optional(),
});

export const updateJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: jobStatusSchema,
  priority: jobPrioritySchema,
  scheduledDate: z.string().nullable().optional(),
  completedDate: z.string().nullable().optional(),
});

export const linkJobDocumentSchema = z.object({
  documentId: z.string().uuid(),
});
