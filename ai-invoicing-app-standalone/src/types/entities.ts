export type UUID = string;

export type DocumentType =
  | 'invoice'
  | 'quote'
  | 'receipt'
  | 'purchase_order'
  | 'delivery_docket'
  | 'contract'
  | 'custom';

export type PaymentState = 'Draft' | 'Sent' | 'Awaiting Payment' | 'Paid' | 'Cancelled';

export type ReminderState = 'None' | 'Scheduled' | 'Paused' | 'Stopped';
export type JobStatus =
  | 'Draft'
  | 'Scheduled'
  | 'In Progress'
  | 'On Hold'
  | 'Completed'
  | 'Cancelled';
export type JobPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

import type { TimelineEventKey } from '../domain/timeline/taxonomy.js';

export type TimelineEventType = string;
export type { TimelineEventKey };

export interface DocumentRecord {
  id: UUID;
  documentType: DocumentType;
  title: string;
  entityId: UUID;
  searchableText: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: UUID;
  displayName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  abnTaxId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: UUID;
  name: string;
  canBeAssigned: boolean;
  canManageAssignments: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: UUID;
  displayName: string;
  email: string | null;
  isActive: boolean;
  roleIds: UUID[];
  createdAt: string;
  updatedAt: string;
}

export interface BrandingProfile {
  id: UUID;
  companyName: string;
  legalName: string | null;
  abnTaxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  logoReference: string | null;
  primaryColor: string;
  secondaryColor: string;
  updatedAt: string;
}

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
}

export interface InvoiceTotals {
  subtotal: number;
  gstTotal: number;
  total: number;
}

export interface InvoiceDraft {
  id: UUID;
  customerId: UUID;
  title: string;
  issueDate: string;
  dueDate: string;
  notes: string | null;
  paymentTerms: string | null;
  invoiceNumber: string | null;
  status: 'Draft' | 'Finalised';
  paymentState: PaymentState;
  reminderState: ReminderState;
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
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
  completedDate: string | null;
  createdAt: string;
  updatedAt: string;
}
