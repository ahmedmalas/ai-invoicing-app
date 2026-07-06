import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const customerIdSchema = z.object({ id: z.string().uuid() });
const jobSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
});
const invoiceSchema = z.object({
  id: z.string().uuid(),
});

describe('jobs happy path e2e', () => {
  it('creates, retrieves, updates, links invoice documents, and searches jobs', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Jobs E2E Customer',
        email: 'jobs-e2e@example.test',
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = customerIdSchema.parse(customerRes.json());

    const createJobRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        title: 'Install equipment',
        description: 'Install and configure equipment onsite',
        customerId: customer.id,
        status: 'Scheduled',
        priority: 'Normal',
        scheduledDate: '2026-07-12',
      },
    });
    expect(createJobRes.statusCode).toBe(201);
    const createdJob = jobSchema.parse(createJobRes.json());

    const createInvoiceRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Linked invoice',
        issueDate: '2026-07-10',
        dueDate: '2026-07-20',
        lineItems: [
          {
            description: 'Service',
            quantity: 2,
            unitPrice: 100,
            gstApplicable: true,
          },
        ],
      },
    });
    expect(createInvoiceRes.statusCode).toBe(201);
    const createdInvoice = invoiceSchema.parse(createInvoiceRes.json());

    const getJobRes = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}`,
    });
    expect(getJobRes.statusCode).toBe(200);
    const retrieved = jobSchema.parse(getJobRes.json());
    expect(retrieved.title).toBe('Install equipment');

    const updateJobRes = await app.inject({
      method: 'PUT',
      url: `/jobs/${createdJob.id}`,
      payload: {
        title: 'Install equipment - completed',
        description: 'Finished installation',
        status: 'Completed',
        priority: 'High',
        completedDate: '2026-07-13',
      },
    });
    expect(updateJobRes.statusCode).toBe(200);
    const updated = jobSchema.parse(updateJobRes.json());
    expect(updated.status).toBe('Completed');
    expect(updated.priority).toBe('High');

    const linkRes = await app.inject({
      method: 'POST',
      url: `/jobs/${createdJob.id}/documents`,
      payload: {
        documentId: createdInvoice.id,
      },
    });
    expect(linkRes.statusCode).toBe(201);

    const listLinkedRes = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}/documents`,
    });
    expect(listLinkedRes.statusCode).toBe(200);
    const linkedPayload = z
      .object({
        documents: z.array(
          z.object({
            id: z.string().uuid(),
            jobId: z.string().uuid(),
            documentId: z.string().uuid(),
            document: z.object({
              id: z.string().uuid(),
              documentType: z.string(),
            }),
          }),
        ),
      })
      .parse(listLinkedRes.json());
    expect(linkedPayload.documents).toHaveLength(1);
    expect(linkedPayload.documents[0]?.documentId).toBe(createdInvoice.id);
    expect(linkedPayload.documents[0]?.document.documentType).toBe('invoice');

    const duplicateLinkRes = await app.inject({
      method: 'POST',
      url: `/jobs/${createdJob.id}/documents`,
      payload: {
        documentId: createdInvoice.id,
      },
    });
    expect(duplicateLinkRes.statusCode).toBe(409);

    const listRes = await app.inject({
      method: 'GET',
      url: '/jobs',
    });
    expect(listRes.statusCode).toBe(200);
    const listPayload = z
      .object({
        jobs: z.array(jobSchema),
      })
      .parse(listRes.json());
    expect(listPayload.jobs).toHaveLength(1);

    const searchRes = await app.inject({
      method: 'GET',
      url: '/search?q=equipment',
    });
    expect(searchRes.statusCode).toBe(200);
    const searchPayload = z
      .object({
        jobs: z.array(z.object({ id: z.string().uuid() })),
      })
      .parse(searchRes.json());
    expect(searchPayload.jobs.some((job) => job.id === createdJob.id)).toBe(true);

    await app.close();
  });
});
