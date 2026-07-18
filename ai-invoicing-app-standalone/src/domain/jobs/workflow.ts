import { normalizeJobStatus, type JobStatus } from './statuses.js';

const JOB_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ['Scheduled', 'Assigned', 'Cancelled'],
  Scheduled: [
    'Assigned',
    'Travelling',
    'On Site',
    'Commenced',
    'In Progress',
    'On Hold',
    'Awaiting Customer',
    'Cancelled',
  ],
  Assigned: [
    'Scheduled',
    'Travelling',
    'On Site',
    'Commenced',
    'In Progress',
    'Awaiting Customer',
    'Cancelled',
  ],
  Travelling: ['On Site', 'Commenced', 'In Progress', 'Access Required', 'Cancelled'],
  'On Site': [
    'Commenced',
    'In Progress',
    'Access Required',
    'Awaiting Customer',
    'Awaiting Parts',
    'Cancelled',
  ],
  Commenced: [
    'Partial',
    'Awaiting Parts',
    'Awaiting Customer',
    'Access Required',
    'On Hold',
    'Completed',
    'Cancelled',
  ],
  'In Progress': [
    'Partial',
    'Awaiting Parts',
    'Awaiting Customer',
    'Access Required',
    'On Hold',
    'Completed',
    'Cancelled',
    'Commenced',
  ],
  Partial: ['Commenced', 'In Progress', 'Awaiting Parts', 'Completed', 'Cancelled'],
  'Awaiting Parts': ['Commenced', 'In Progress', 'Scheduled', 'Completed', 'Cancelled'],
  'Awaiting Customer': ['Scheduled', 'Commenced', 'In Progress', 'Completed', 'Cancelled'],
  'Access Required': ['On Site', 'Commenced', 'In Progress', 'Scheduled', 'Cancelled'],
  'On Hold': ['Scheduled', 'Commenced', 'In Progress', 'Assigned', 'Cancelled'],
  Completed: ['Invoiced', 'Paid'],
  Invoiced: ['Paid'],
  Paid: [],
  Cancelled: [],
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  // Allow transitions using either legacy or canonical labels when they normalize equal
  if (normalizeJobStatus(from) === normalizeJobStatus(to) && from !== to) {
    return true;
  }
  const allowed = JOB_STATUS_TRANSITIONS[from] ?? [];
  if (allowed.includes(to)) return true;
  // Also allow transitioning to the canonical equivalent of a listed legacy target
  return allowed.some((status) => normalizeJobStatus(status as JobStatus) === normalizeJobStatus(to));
}

export function assertValidJobStatusTransitionOrThrow(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new Error('INVALID_JOB_STATUS_TRANSITION');
  }
}

export function listAllowedJobTransitions(from: JobStatus): JobStatus[] {
  return [...(JOB_STATUS_TRANSITIONS[from] ?? [])] as JobStatus[];
}
