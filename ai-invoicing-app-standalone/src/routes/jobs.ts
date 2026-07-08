import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createJobSchema, linkJobDocumentSchema, updateJobSchema } from '../domain/jobs/validation.js';
import { paginateArray, parsePagination } from './pagination.js';

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.post('/jobs', async (request, reply) => {
    const body = createJobSchema.parse(request.body);
    const job = app.db.createJob(body);
    return reply.code(201).send(job);
  });

  app.put('/jobs/:jobId', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = updateJobSchema.parse(request.body);
    return app.db.updateJob(params.jobId, body);
  });

  app.get('/jobs/:jobId', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const job = app.db.getJobById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: 'Job not found' });
    }
    return job;
  });

  app.get('/jobs', async (request) => {
    const pagination = parsePagination(request.query);
    return {
      jobs: paginateArray(app.db.listJobs(), pagination),
    };
  });

  app.post('/jobs/:jobId/documents', async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = linkJobDocumentSchema.parse(request.body);
    const link = app.db.linkDocumentToJob(params.jobId, body.documentId);
    return reply.code(201).send(link);
  });

  app.get('/jobs/:jobId/documents', async (request) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      documents: paginateArray(app.db.listJobDocuments(params.jobId), pagination),
    };
  });
};
