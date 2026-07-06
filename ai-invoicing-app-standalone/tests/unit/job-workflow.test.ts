import { describe, expect, it } from 'vitest';

import {
  assertValidJobStatusTransitionOrThrow,
  canTransitionJobStatus,
} from '../../src/domain/jobs/workflow.js';

describe('job workflow transitions', () => {
  it('accepts allowed transitions', () => {
    expect(canTransitionJobStatus('Draft', 'Scheduled')).toBe(true);
    expect(canTransitionJobStatus('Scheduled', 'In Progress')).toBe(true);
    expect(canTransitionJobStatus('In Progress', 'Completed')).toBe(true);
    expect(() => assertValidJobStatusTransitionOrThrow('On Hold', 'In Progress')).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionJobStatus('Completed', 'Scheduled')).toBe(false);
    expect(() => assertValidJobStatusTransitionOrThrow('Cancelled', 'Draft')).toThrow(
      'INVALID_JOB_STATUS_TRANSITION',
    );
  });
});
