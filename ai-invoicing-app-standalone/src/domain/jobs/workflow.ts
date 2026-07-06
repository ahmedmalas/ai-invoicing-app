import type { JobStatus } from '../../types/entities.js';

const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  Draft: ['Scheduled', 'Cancelled'],
  Scheduled: ['In Progress', 'On Hold', 'Cancelled'],
  'In Progress': ['On Hold', 'Completed', 'Cancelled'],
  'On Hold': ['Scheduled', 'In Progress', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  if (from === to) {
    return true;
  }

  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function assertValidJobStatusTransitionOrThrow(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new Error('INVALID_JOB_STATUS_TRANSITION');
  }
}
