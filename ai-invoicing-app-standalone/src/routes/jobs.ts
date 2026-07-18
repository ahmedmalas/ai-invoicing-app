import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  assignmentResponseSchema,
  calendarQuerySchema,
  checklistReplaceSchema,
  createJobSchema,
  formSubmissionSchema,
  formTemplateSchema,
  labourLineSchema,
  linkJobDocumentSchema,
  listJobsFilterSchema,
  notificationSchema,
  partLineSchema,
  portalRescheduleSchema,
  portalTokenSchema,
  recurrenceSchema,
  rescheduleJobSchema,
  signatureSchema,
  statusDefinitionSchema,
  timeEntrySchema,
  updateJobSchema,
  upsertAssignmentsSchema,
} from '../domain/jobs/validation.js';
import { parsePagination } from './pagination.js';

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.post('/jobs', async (request, reply) => {
    const body = createJobSchema.parse(request.body);
    const job = await app.db.createJob(body);
    return reply.code(201).send(job);
  });

  app.put('/jobs/:jobId', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = updateJobSchema.parse(request.body);
    return await app.db.updateJob(params.jobId, body);
  });

  app.get('/jobs/calendar/events', async (request) => {
    const query = calendarQuerySchema.parse(request.query);
    return {
      view: query.view,
      events: await app.db.listJobCalendarEvents(query),
    };
  });

  app.get('/jobs/routes/daily', async (request) => {
    const query = z
      .object({
        technicianId: z.string().uuid(),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query);
    return {
      technicianId: query.technicianId,
      day: query.day,
      stops: await app.db.getTechnicianDailyRoute(query.technicianId, query.day),
    };
  });

  app.get('/jobs/:jobId', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const detail = await app.db.getJobDetail(params.jobId);
    if (detail) return detail;
    const job = await app.db.getJobById(params.jobId);
    if (!job) return reply.code(404).send({ message: 'Job not found' });
    return job;
  });

  app.get('/jobs', async (request) => {
    const pagination = parsePagination(request.query);
    const filter = listJobsFilterSchema.parse(request.query);
    const jobs = await app.db.listJobs(pagination);
    const filtered = jobs.filter((job) => {
      if (filter.status && job.status !== filter.status) return false;
      if (filter.priority && job.priority !== filter.priority) return false;
      if (filter.customerId && job.customerId !== filter.customerId) return false;
      if (filter.teamId && job.teamId !== filter.teamId) return false;
      if (filter.technicianId && job.assignedUserId !== filter.technicianId) return false;
      if (filter.suburb && !(job.suburb || '').toLowerCase().includes(filter.suburb.toLowerCase())) {
        return false;
      }
      if (filter.search) {
        const hay = `${job.title} ${job.jobNumber} ${job.description || ''}`.toLowerCase();
        if (!hay.includes(filter.search.toLowerCase())) return false;
      }
      if (filter.from && job.scheduledEndAt && job.scheduledEndAt < filter.from) return false;
      if (filter.to && job.scheduledStartAt && job.scheduledStartAt > filter.to) return false;
      return true;
    });
    return { jobs: filtered };
  });

  app.post('/jobs/:jobId/documents', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = linkJobDocumentSchema.parse(request.body);
    const link = await app.db.linkDocumentToJob(params.jobId, body.documentId);
    return reply.code(201).send(link);
  });

  app.get('/jobs/:jobId/documents', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      documents: await app.db.listJobDocuments(params.jobId, pagination),
    };
  });

  app.patch('/jobs/:jobId/schedule', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = rescheduleJobSchema.parse(request.body);
    const payload: {
      scheduledStartAt: string;
      scheduledEndAt: string;
      assignedUserId?: string | null;
    } = {
      scheduledStartAt: body.scheduledStartAt!,
      scheduledEndAt: body.scheduledEndAt!,
    };
    if (body.assignedUserId !== undefined) payload.assignedUserId = body.assignedUserId;
    return app.db.rescheduleJob(params.jobId, payload);
  });

  app.put('/jobs/:jobId/assignments', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = upsertAssignmentsSchema.parse(request.body);
    return {
      assignments: await app.db.replaceJobAssignments(
        params.jobId,
        body.assignments.map((assignment) => {
          const row: {
            userId: string;
            teamId?: string | null;
            isPrimary?: boolean;
            responseStatus?: string;
          } = { userId: assignment.userId };
          if (assignment.teamId !== undefined) row.teamId = assignment.teamId;
          if (assignment.isPrimary !== undefined) row.isPrimary = assignment.isPrimary;
          if (assignment.responseStatus !== undefined) row.responseStatus = assignment.responseStatus;
          return row;
        }),
      ),
    };
  });

  app.patch('/jobs/:jobId/assignments/:userId', async (request) => {
    const params = z
      .object({ jobId: z.string().uuid(), userId: z.string().uuid() })
      .parse(request.params);
    const body = assignmentResponseSchema.parse(request.body);
    return app.db.updateJobAssignmentResponse(params.jobId, params.userId, body.responseStatus);
  });

  app.put('/jobs/:jobId/checklist', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = checklistReplaceSchema.parse(request.body);
    return { checklist: await app.db.replaceJobChecklist(params.jobId, body.items) };
  });

  app.post('/jobs/:jobId/time-entries', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = timeEntrySchema.parse(request.body);
    const entry = await app.db.addJobTimeEntry(params.jobId, body);
    return reply.code(201).send(entry);
  });

  app.get('/jobs/:jobId/time-summary', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return app.db.getJobTimeSummary(params.jobId);
  });

  app.post('/jobs/:jobId/parts', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = partLineSchema.parse(request.body);
    return reply.code(201).send(await app.db.addJobPart(params.jobId, body));
  });

  app.post('/jobs/:jobId/labour', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = labourLineSchema.parse(request.body);
    return reply.code(201).send(await app.db.addJobLabour(params.jobId, body));
  });

  app.post('/jobs/:jobId/signatures', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = signatureSchema.parse(request.body);
    return reply.code(201).send(await app.db.addJobSignature(params.jobId, body));
  });

  app.post('/jobs/:jobId/forms', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = formSubmissionSchema.parse(request.body);
    return reply.code(201).send(await app.db.submitJobForm(params.jobId, body));
  });

  app.put('/jobs/:jobId/recurrence', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = recurrenceSchema.parse(request.body);
    return app.db.setJobRecurrence(params.jobId, body);
  });

  app.post('/jobs/:jobId/notifications', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = notificationSchema.parse(request.body);
    return reply.code(201).send(await app.db.queueJobNotification(params.jobId, body));
  });

  app.get('/jobs/:jobId/notifications', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return { notifications: await app.db.listJobNotifications(params.jobId) };
  });

  app.get('/job-statuses', async () => ({
    statuses: await app.db.listJobStatusDefinitions(),
  }));

  app.put('/job-statuses', async (request) => {
    const body = statusDefinitionSchema.parse(request.body);
    return app.db.upsertJobStatusDefinition(body);
  });

  app.get('/job-forms/templates', async () => ({
    templates: await app.db.listJobFormTemplates(),
  }));

  app.post('/job-forms/templates', async (request, reply) => {
    const body = formTemplateSchema.parse(request.body);
    return reply.code(201).send(await app.db.createJobFormTemplate(body));
  });

  app.post('/portal/tokens', async (request, reply) => {
    const body = portalTokenSchema.parse(request.body);
    return reply
      .code(201)
      .send(await app.db.createCustomerPortalToken(body.customerId, body.expiresInHours));
  });

  app.get('/portal/:token', async (request, reply) => {
    const params = z.object({ token: z.string().min(16) }).parse(request.params);
    try {
      return await app.db.getCustomerPortalSnapshot(params.token);
    } catch {
      return reply.code(401).send({ message: 'PORTAL_TOKEN_INVALID' });
    }
  });

  app.post('/portal/:token/confirm', async (request, reply) => {
    const params = z.object({ token: z.string().min(16) }).parse(request.params);
    const body = z.object({ jobId: z.string().uuid() }).parse(request.body);
    try {
      const snapshot = (await app.db.getCustomerPortalSnapshot(params.token)) as {
        session: { customerId: string };
      };
      const job = await app.db.getJobById(body.jobId);
      if (!job || job.customerId !== snapshot.session.customerId) {
        return reply.code(404).send({ message: 'JOB_NOT_FOUND' });
      }
      await app.db.queueJobNotification(body.jobId, {
        kind: 'booking_confirmation',
        channel: 'email',
        recipient: 'portal@customer',
        subject: 'Appointment confirmed',
        body: 'Customer confirmed the appointment via portal.',
      });
      return { confirmed: true, jobId: body.jobId };
    } catch {
      return reply.code(401).send({ message: 'PORTAL_TOKEN_INVALID' });
    }
  });

  app.post('/portal/:token/reschedule-request', async (request, reply) => {
    const params = z.object({ token: z.string().min(16) }).parse(request.params);
    const body = portalRescheduleSchema.parse(request.body);
    try {
      const snapshot = (await app.db.getCustomerPortalSnapshot(params.token)) as {
        session: { customerId: string };
      };
      const job = await app.db.getJobById(body.jobId);
      if (!job || job.customerId !== snapshot.session.customerId) {
        return reply.code(404).send({ message: 'JOB_NOT_FOUND' });
      }
      await app.db.queueJobNotification(body.jobId, {
        kind: 'reschedule_request',
        channel: 'in_app',
        recipient: 'office',
        subject: 'Reschedule requested',
        body: `Customer requested ${body.preferredStartAt}. ${body.note || ''}`.trim(),
      });
      return { requested: true };
    } catch {
      return reply.code(401).send({ message: 'PORTAL_TOKEN_INVALID' });
    }
  });

  app.post('/portal/:token/quotes/:quoteId/approve', async (request, reply) => {
    const params = z
      .object({ token: z.string().min(16), quoteId: z.string().uuid() })
      .parse(request.params);
    try {
      const snapshot = (await app.db.getCustomerPortalSnapshot(params.token)) as {
        session: { customerId: string };
      };
      const quote = await app.db.getQuoteById(params.quoteId);
      if (!quote || quote.customerId !== snapshot.session.customerId) {
        return reply.code(404).send({ message: 'QUOTE_NOT_FOUND' });
      }
      const updated = await app.db.transitionQuoteStatus(params.quoteId, 'Accepted');
      return { quote: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PORTAL_QUOTE_APPROVE_FAILED';
      if (message === 'PORTAL_TOKEN_INVALID') {
        return reply.code(401).send({ message });
      }
      return reply.code(400).send({ message });
    }
  });
};
