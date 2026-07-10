import type { DocumentRecord, DocumentType, UUID } from '../../types/entities.js';

export interface DocumentEntity {
  id: UUID;
  documentType: DocumentType;
  toDocumentRecord(): DocumentRecord;
}

export interface SearchResultGroup<T> {
  category: 'documents' | 'customers' | 'invoices';
  items: T[];
}
