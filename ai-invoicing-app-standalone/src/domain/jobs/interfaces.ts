import type { UUID } from '../../types/entities.js';

export interface JobDocumentLink {
  id: UUID;
  jobId: UUID;
  documentId: UUID;
  createdAt: string;
}

/** @deprecated Prefer job_parts / expenses module linkage via invoice/expense ids on the job. */
export interface JobExpensesPlaceholder {
  jobId: UUID;
}

/** @deprecated Prefer customer_payments allocated from completed/invoiced jobs. */
export interface JobPaymentsPlaceholder {
  jobId: UUID;
}

/** @deprecated Prefer attachments linked through documents / future media table. */
export interface JobPhotosPlaceholder {
  jobId: UUID;
}

/** @deprecated Prefer internalNotes / customerNotes on the job record. */
export interface JobNotesPlaceholder {
  jobId: UUID;
}
