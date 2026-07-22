export declare function collectInvoiceWorkspacePayload(form: unknown): {
  customerId: string;
  title: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  paymentTerms?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    gstApplicable: boolean;
  }>;
};

export declare function invoicePayloadIsAutosaveReady(body: unknown): boolean;
