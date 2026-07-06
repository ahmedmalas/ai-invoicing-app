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
});
