import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('jobs integration', () => {
  it('supports CRUD, customer linkage, timeline, and search visibility', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Job Customer',
      email: 'job-customer@example.test',
    });

    const created = db.createJob({
      title: 'Initial Site Visit',
      description: 'Inspect the site and gather requirements',
      customerId: customer.id,
      status: 'Scheduled',
      priority: 'High',
      scheduledDate: '2026-07-10',
    });

    expect(created.customerId).toBe(customer.id);
    expect(created.jobNumber).toMatch(/^JOB-\d{4}-\d{6}$/);

    const fetched = db.getJobById(created.id);
    expect(fetched?.title).toBe('Initial Site Visit');

    const updated = db.updateJob(created.id, {
      title: 'Initial Site Visit - Revised',
      description: 'Requirements validated',
      status: 'Completed',
      priority: 'Urgent',
      completedDate: '2026-07-11',
    });
    expect(updated.status).toBe('Completed');
    expect(updated.priority).toBe('Urgent');
    expect(updated.completedDate).toBe('2026-07-11');

    const listed = db.listJobs();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const timeline = db.getTimelineForEntity('job', created.id);
    expect(timeline.map((event) => (event as { eventKey: string }).eventKey)).toEqual([
      'job.created',
      'job.updated',
      'job.completed',
    ]);

    const search = db.search('Site Visit');
    expect(search.jobs).toHaveLength(1);
    expect(search.jobs[0]?.id).toBe(created.id);

    db.close();
  });

  it('links documents to jobs and lists linked documents with timeline events', () => {
    const db = createDatabase(':memory:');
    const customer = db.createCustomer({
      displayName: 'Link Customer',
    });
    const job = db.createJob({
      title: 'Job With Linked Invoice',
      customerId: customer.id,
      status: 'Draft',
      priority: 'Normal',
    });
    const invoice = db.createInvoiceDraft({
      customerId: customer.id,
      title: 'Invoice for linked job',
      issueDate: '2026-07-06',
      dueDate: '2026-07-20',
      lineItems: [
        {
          description: 'Work',
          quantity: 1,
          unitPrice: 120,
          gstApplicable: true,
        },
      ],
    });

    const link = db.linkDocumentToJob(job.id, invoice.id);
    expect(link.jobId).toBe(job.id);
    expect(link.documentId).toBe(invoice.id);
    expect(link.document.documentType).toBe('invoice');

    const linked = db.listJobDocuments(job.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.document.id).toBe(invoice.id);

    const jobTimeline = db.getTimelineForEntity('job', job.id);
    expect(jobTimeline.map((event) => (event as { eventKey: string }).eventKey)).toContain(
      'job.document_linked',
    );

    const documentTimeline = db.getTimelineForEntity('document', invoice.id);
    expect(documentTimeline.map((event) => (event as { eventKey: string }).eventKey)).toContain(
      'document.linked_to_job',
    );

    expect(() => db.linkDocumentToJob(job.id, invoice.id)).toThrow('JOB_DOCUMENT_LINK_EXISTS');
    expect(() => db.linkDocumentToJob(job.id, '550e8400-e29b-41d4-a716-446655440000')).toThrow(
      'Document not found',
    );

    db.close();
  });
});
