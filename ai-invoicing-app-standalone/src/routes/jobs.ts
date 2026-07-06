import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createJobSchema, updateJobSchema } from '../domain/jobs/validation.js';

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

  app.get('/jobs', async () => {
    return {
      jobs: app.db.listJobs(),
    };
  });
};
