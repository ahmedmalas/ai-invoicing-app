import type { UUID } from '../../types/entities.js';

export interface JobDocumentLink {
  id: UUID;
  jobId: UUID;
  documentId: UUID;
  createdAt: string;
}

export interface JobExpensesPlaceholder {
  jobId: UUID;
}

export interface JobPaymentsPlaceholder {
  jobId: UUID;
}

export interface JobPhotosPlaceholder {
  jobId: UUID;
}

export interface JobNotesPlaceholder {
  jobId: UUID;
}
