import { describe, expect, it } from 'vitest';

import { jobPrioritySchema, jobStatusSchema } from '../../src/domain/jobs/validation.js';

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
