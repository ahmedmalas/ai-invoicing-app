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

const scheduleSchema = z
  .object({
    scheduledStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    scheduledEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scheduledStartAt && value.scheduledEndAt) {
      const startMs = Date.parse(value.scheduledStartAt);
      const endMs = Date.parse(value.scheduledEndAt);
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scheduledEndAt must be equal to or after scheduledStartAt',
          path: ['scheduledEndAt'],
        });
      }
    }
  });

export const createJobSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    customerId: z.string().uuid(),
    status: jobStatusSchema.default('Draft'),
    priority: jobPrioritySchema.default('Normal'),
    scheduledStartAt: z.string().datetime({ offset: true }).optional(),
    scheduledEndAt: z.string().datetime({ offset: true }).optional(),
    assignedUserId: z.string().uuid().optional(),
    assignedUserName: z.string().min(1).optional(),
    teamId: z.string().uuid().optional(),
    completedDate: z.string().optional(),
  })
  .and(scheduleSchema);

export const updateJobSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    status: jobStatusSchema,
    priority: jobPrioritySchema,
    scheduledStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    scheduledEndAt: z.string().datetime({ offset: true }).nullable().optional(),
    assignedUserId: z.string().uuid().nullable().optional(),
    assignedUserName: z.string().min(1).nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    completedDate: z.string().nullable().optional(),
  })
  .and(scheduleSchema);

export const linkJobDocumentSchema = z.object({
  documentId: z.string().uuid(),
});
