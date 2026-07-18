import { z } from 'zod';

/** Canonical field-service statuses (customisable per business via job_status_definitions). */
export const CANONICAL_JOB_STATUSES = [
  'Draft',
  'Scheduled',
  'Assigned',
  'Travelling',
  'On Site',
  'Commenced',
  'Partial',
  'Awaiting Parts',
  'Awaiting Customer',
  'Access Required',
  'Completed',
  'Cancelled',
  'Invoiced',
  'Paid',
] as const;

/** Legacy statuses retained for API compatibility with existing clients/tests. */
export const LEGACY_JOB_STATUSES = ['In Progress', 'On Hold'] as const;

export const JOB_STATUSES = [...CANONICAL_JOB_STATUSES, ...LEGACY_JOB_STATUSES] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobStatusSchema = z.enum(JOB_STATUSES);

export const DEFAULT_STATUS_COLOURS: Record<(typeof CANONICAL_JOB_STATUSES)[number], string> = {
  Draft: '#9CA3AF',
  Scheduled: '#3B82F6',
  Assigned: '#6366F1',
  Travelling: '#F59E0B',
  'On Site': '#F97316',
  Commenced: '#10B981',
  Partial: '#14B8A6',
  'Awaiting Parts': '#A855F7',
  'Awaiting Customer': '#EC4899',
  'Access Required': '#EF4444',
  Completed: '#059669',
  Cancelled: '#6B7280',
  Invoiced: '#0EA5E9',
  Paid: '#047857',
};

/** Normalize legacy labels into the canonical lifecycle. */
export function normalizeJobStatus(status: JobStatus): (typeof CANONICAL_JOB_STATUSES)[number] {
  if (status === 'In Progress') return 'Commenced';
  if (status === 'On Hold') return 'Awaiting Customer';
  return status;
}

export const ASSIGNMENT_RESPONSE_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'en_route',
  'arrived',
  'started',
  'finished',
] as const;

export type AssignmentResponseStatus = (typeof ASSIGNMENT_RESPONSE_STATUSES)[number];

export const TIME_ENTRY_TYPES = [
  'travel',
  'work',
  'break',
  'overtime',
] as const;

export type TimeEntryType = (typeof TIME_ENTRY_TYPES)[number];

export const FORM_TEMPLATE_KINDS = [
  'checklist',
  'safety',
  'service_report',
  'maintenance_report',
  'compliance_certificate',
  'custom',
] as const;

export type FormTemplateKind = (typeof FORM_TEMPLATE_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_KINDS = [
  'booking_confirmation',
  'technician_on_the_way',
  'arrival',
  'job_completed',
  'follow_up',
  'review_request',
  'appointment_confirm_request',
  'reschedule_request',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
