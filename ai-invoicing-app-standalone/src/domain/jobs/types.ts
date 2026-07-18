import type {
  AssignmentResponseStatus,
  FormTemplateKind,
  JobStatus,
  NotificationChannel,
  NotificationKind,
  TimeEntryType,
} from './statuses.js';
import type { JobPriority, UUID } from '../../types/entities.js';

export interface JobStatusDefinition {
  id: string;
  key: string;
  label: string;
  colour: string;
  sortOrder: number;
  isTerminal: boolean;
  isDefault: boolean;
  active: boolean;
}

export interface JobAssignment {
  id: UUID;
  jobId: UUID;
  userId: UUID;
  userName: string;
  teamId: UUID | null;
  responseStatus: AssignmentResponseStatus;
  isPrimary: boolean;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobTimeEntry {
  id: UUID;
  jobId: UUID;
  userId: UUID | null;
  entryType: TimeEntryType;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  billable: boolean;
  notes: string | null;
  createdAt: string;
}

export interface JobChecklistItem {
  id: UUID;
  jobId: UUID;
  label: string;
  completed: boolean;
  sortOrder: number;
  completedAt: string | null;
  completedBy: string | null;
}

export interface JobPartLine {
  id: UUID;
  jobId: UUID;
  description: string;
  quantity: number;
  unitCost: number;
  billable: boolean;
}

export interface JobLabourLine {
  id: UUID;
  jobId: UUID;
  description: string;
  hours: number;
  rate: number;
  billable: boolean;
  userId: UUID | null;
}

export interface JobSignature {
  id: UUID;
  jobId: UUID;
  signerName: string;
  signedAt: string;
  signatureDataUrl: string;
  latitude: number | null;
  longitude: number | null;
  purpose: 'service_report' | 'completion' | 'invoice' | 'other';
  createdAt: string;
}

export interface JobFormTemplate {
  id: UUID;
  name: string;
  kind: FormTemplateKind;
  schemaJson: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobFormSubmission {
  id: UUID;
  jobId: UUID;
  templateId: UUID;
  answersJson: Record<string, unknown>;
  submittedBy: string | null;
  submittedAt: string;
}

export interface JobRecurrenceRule {
  id: UUID;
  jobId: UUID;
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  untilDate: string | null;
  byWeekday: string | null;
  createdAt: string;
}

export interface JobNotification {
  id: UUID;
  jobId: UUID;
  kind: NotificationKind;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  /** Reserved for future SMS / push providers */
  providerRef: string | null;
}

export interface CustomerPortalSession {
  id: UUID;
  customerId: UUID;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface JobDetailExtras {
  siteAddress: string | null;
  suburb: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  colour: string | null;
  quoteId: string | null;
  invoiceId: string | null;
  latitude: number | null;
  longitude: number | null;
  estimatedTravelMinutes: number | null;
}

export interface EnrichedJob {
  id: UUID;
  jobNumber: string;
  title: string;
  description: string | null;
  customerId: UUID;
  status: JobStatus;
  priority: JobPriority;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  teamId: string | null;
  completedDate: string | null;
  createdAt: string;
  updatedAt: string;
  siteAddress: string | null;
  suburb: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  colour: string | null;
  quoteId: string | null;
  invoiceId: string | null;
  latitude: number | null;
  longitude: number | null;
  estimatedTravelMinutes: number | null;
  assignments: JobAssignment[];
  checklist: JobChecklistItem[];
  timeEntries: JobTimeEntry[];
  parts: JobPartLine[];
  labour: JobLabourLine[];
  signatures: JobSignature[];
}

export interface CalendarJobEvent {
  id: string;
  jobNumber: string;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  colour: string;
  customerId: string;
  customerName: string | null;
  suburb: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  assignedUserIds: string[];
  teamId: string | null;
}

export interface RouteStop {
  jobId: string;
  title: string;
  siteAddress: string | null;
  suburb: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduledStartAt: string | null;
  estimatedTravelMinutes: number | null;
  mapsUrl: string | null;
}
