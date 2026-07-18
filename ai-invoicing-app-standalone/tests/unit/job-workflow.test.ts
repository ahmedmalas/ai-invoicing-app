import { describe, expect, it } from 'vitest';

import {
  assertValidJobStatusTransitionOrThrow,
  canTransitionJobStatus,
} from '../../src/domain/jobs/workflow.js';

describe('job workflow transitions', () => {
  it('accepts allowed transitions including expanded field statuses', () => {
    expect(canTransitionJobStatus('Draft', 'Scheduled')).toBe(true);
    expect(canTransitionJobStatus('Scheduled', 'Assigned')).toBe(true);
    expect(canTransitionJobStatus('Assigned', 'Travelling')).toBe(true);
    expect(canTransitionJobStatus('Travelling', 'On Site')).toBe(true);
    expect(canTransitionJobStatus('On Site', 'Commenced')).toBe(true);
    expect(canTransitionJobStatus('Commenced', 'Completed')).toBe(true);
    expect(canTransitionJobStatus('Completed', 'Invoiced')).toBe(true);
    expect(canTransitionJobStatus('Invoiced', 'Paid')).toBe(true);
    // Legacy aliases remain valid
    expect(canTransitionJobStatus('Scheduled', 'In Progress')).toBe(true);
    expect(canTransitionJobStatus('In Progress', 'Completed')).toBe(true);
    expect(() => assertValidJobStatusTransitionOrThrow('On Hold', 'In Progress')).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionJobStatus('Paid', 'Scheduled')).toBe(false);
    expect(canTransitionJobStatus('Completed', 'Scheduled')).toBe(false);
    expect(() => assertValidJobStatusTransitionOrThrow('Cancelled', 'Draft')).toThrow(
      'INVALID_JOB_STATUS_TRANSITION',
    );
  });
});
