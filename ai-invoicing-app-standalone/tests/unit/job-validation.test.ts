import { describe, expect, it } from 'vitest';

import {
  createJobSchema,
  updateJobSchema,
  jobPrioritySchema,
  jobStatusSchema,
  linkJobDocumentSchema,
} from '../../src/domain/jobs/validation.js';

describe('job status validation', () => {
  it('accepts all allowed statuses', () => {
    expect(jobStatusSchema.parse('Draft')).toBe('Draft');
    expect(jobStatusSchema.parse('Scheduled')).toBe('Scheduled');
    expect(jobStatusSchema.parse('In Progress')).toBe('In Progress');
    expect(jobStatusSchema.parse('On Hold')).toBe('On Hold');
    expect(jobStatusSchema.parse('Completed')).toBe('Completed');
    expect(jobStatusSchema.parse('Cancelled')).toBe('Cancelled');
  });

  it('rejects unknown statuses', () => {
    expect(() => jobStatusSchema.parse('Archived')).toThrow();
  });
});

describe('job priority validation', () => {
  it('accepts all allowed priorities', () => {
    expect(jobPrioritySchema.parse('Low')).toBe('Low');
    expect(jobPrioritySchema.parse('Normal')).toBe('Normal');
    expect(jobPrioritySchema.parse('High')).toBe('High');
    expect(jobPrioritySchema.parse('Urgent')).toBe('Urgent');
  });

  it('rejects unknown priorities', () => {
    expect(() => jobPrioritySchema.parse('Critical')).toThrow();
  });
});

describe('job document link validation', () => {
  it('accepts valid document link payload', () => {
    const parsed = linkJobDocumentSchema.parse({
      documentId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(parsed.documentId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid document id', () => {
    expect(() =>
      linkJobDocumentSchema.parse({
        documentId: 'not-a-uuid',
      }),
    ).toThrow();
  });
});

describe('job schedule validation', () => {
  it('accepts valid scheduled start/end date-time values', () => {
    const parsed = createJobSchema.parse({
      title: 'Schedule Test',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'Scheduled',
      priority: 'Normal',
      scheduledStartAt: '2026-07-08T09:00:00.000Z',
      scheduledEndAt: '2026-07-08T10:00:00.000Z',
    });
    expect(parsed.scheduledStartAt).toBe('2026-07-08T09:00:00.000Z');
    expect(parsed.scheduledEndAt).toBe('2026-07-08T10:00:00.000Z');
  });

  it('rejects schedule ranges where end is before start', () => {
    expect(() =>
      updateJobSchema.parse({
        title: 'Schedule Test',
        status: 'Scheduled',
        priority: 'Normal',
        scheduledStartAt: '2026-07-08T11:00:00.000Z',
        scheduledEndAt: '2026-07-08T10:00:00.000Z',
      }),
    ).toThrow('scheduledEndAt must be equal to or after scheduledStartAt');
  });
});
