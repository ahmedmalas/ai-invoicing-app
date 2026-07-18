import { z } from 'zod';

import {
  ASSIGNMENT_RESPONSE_STATUSES,
  FORM_TEMPLATE_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  TIME_ENTRY_TYPES,
  jobStatusSchema,
} from './statuses.js';

export { jobStatusSchema };

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

const jobDetailFields = {
  siteAddress: z.string().max(500).nullable().optional(),
  suburb: z.string().max(120).nullable().optional(),
  contactPerson: z.string().max(160).nullable().optional(),
  contactPhone: z.string().max(60).nullable().optional(),
  internalNotes: z.string().max(5000).nullable().optional(),
  customerNotes: z.string().max(5000).nullable().optional(),
  colour: z.string().max(32).nullable().optional(),
  quoteId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  estimatedTravelMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
};

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
    assigneeUserIds: z.array(z.string().uuid()).max(20).optional(),
    ...jobDetailFields,
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
    assigneeUserIds: z.array(z.string().uuid()).max(20).optional(),
    ...jobDetailFields,
  })
  .and(scheduleSchema);

export const linkJobDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const rescheduleJobSchema = z
  .object({
    scheduledStartAt: z.string().datetime({ offset: true }),
    scheduledEndAt: z.string().datetime({ offset: true }),
    assignedUserId: z.string().uuid().nullable().optional(),
  })
  .and(scheduleSchema);

export const assignmentResponseSchema = z.object({
  responseStatus: z.enum(ASSIGNMENT_RESPONSE_STATUSES),
});

export const upsertAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().uuid(),
        teamId: z.string().uuid().nullable().optional(),
        isPrimary: z.boolean().optional(),
        responseStatus: z.enum(ASSIGNMENT_RESPONSE_STATUSES).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const timeEntrySchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  entryType: z.enum(TIME_ENTRY_TYPES),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  breakMinutes: z.number().int().min(0).default(0),
  billable: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
});

export const checklistItemSchema = z.object({
  label: z.string().min(1).max(300),
  sortOrder: z.number().int().optional(),
});

export const checklistReplaceSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid().optional(),
    label: z.string().min(1).max(300),
    completed: z.boolean().default(false),
    sortOrder: z.number().int().optional(),
  })),
});

export const partLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
  billable: z.boolean().default(true),
});

export const labourLineSchema = z.object({
  description: z.string().min(1),
  hours: z.number().positive(),
  rate: z.number().min(0),
  billable: z.boolean().default(true),
  userId: z.string().uuid().nullable().optional(),
});

export const signatureSchema = z.object({
  signerName: z.string().min(1).max(160),
  signatureDataUrl: z.string().min(20).max(2_000_000),
  signedAt: z.string().datetime({ offset: true }).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  purpose: z.enum(['service_report', 'completion', 'invoice', 'other']).default('completion'),
});

export const formTemplateSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(FORM_TEMPLATE_KINDS),
  schemaJson: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});

export const formSubmissionSchema = z.object({
  templateId: z.string().uuid(),
  answersJson: z.record(z.string(), z.unknown()).default({}),
  submittedBy: z.string().max(160).nullable().optional(),
});

export const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(365).default(1),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  byWeekday: z.string().max(40).nullable().optional(),
});

export const statusDefinitionSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  colour: z.string().min(4).max(32),
  sortOrder: z.number().int().default(0),
  isTerminal: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const calendarQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  view: z.enum(['day', 'week', 'month', 'timeline']).default('week'),
  technicianId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  priority: jobPrioritySchema.optional(),
  suburb: z.string().max(120).optional(),
  status: jobStatusSchema.optional(),
  teamId: z.string().uuid().optional(),
});

export const notificationSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  channel: z.enum(NOTIFICATION_CHANNELS).default('email'),
  recipient: z.string().min(1).max(320),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

export const portalTokenSchema = z.object({
  customerId: z.string().uuid(),
  expiresInHours: z.number().int().min(1).max(24 * 90).default(72),
});

export const portalRescheduleSchema = z.object({
  jobId: z.string().uuid(),
  preferredStartAt: z.string().datetime({ offset: true }),
  note: z.string().max(2000).optional(),
});

export const listJobsFilterSchema = z.object({
  status: jobStatusSchema.optional(),
  priority: jobPrioritySchema.optional(),
  customerId: z.string().uuid().optional(),
  technicianId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  suburb: z.string().max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  search: z.string().max(200).optional(),
});
