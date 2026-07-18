import { z } from 'zod';

export const expenseStatusSchema = z.enum(['Draft', 'Submitted', 'Approved', 'Reimbursed']);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export interface Expense {
  id: string;
  title: string;
  merchant: string | null;
  expenseDate: string;
  total: number;
  gst: number;
  invoiceNumber: string | null;
  referenceNumber: string | null;
  notes: string | null;
  customerId: string | null;
  jobId: string | null;
  supplierId: string | null;
  status: ExpenseStatus;
  createdAt: string;
  updatedAt: string;
}

export const createExpenseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  merchant: z.string().trim().max(200).nullable().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.number().min(0),
  gst: z.number().min(0).default(0),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  status: expenseStatusSchema.default('Draft'),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export function mapExpenseRow(row: Record<string, unknown>): Expense {
  return {
    id: String(row.id),
    title: String(row.title),
    merchant: (row.merchant as string | null) ?? null,
    expenseDate: String(row.expense_date),
    total: Number(row.total),
    gst: Number(row.gst ?? 0),
    invoiceNumber: (row.invoice_number as string | null) ?? null,
    referenceNumber: (row.reference_number as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    customerId: (row.customer_id as string | null) ?? null,
    jobId: (row.job_id as string | null) ?? null,
    supplierId: (row.supplier_id as string | null) ?? null,
    status: expenseStatusSchema.parse(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
