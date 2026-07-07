import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  BrandingProfile,
  CreditNote,
  CreditNoteLineItem,
  CreditNoteType,
  CustomerPayment,
  PaymentAllocation,
  PurchaseOrder,
  PurchaseOrderBillingStatus,
  PurchaseOrderLineItemInput,
  PurchaseOrderStatus,
  SupplierBillPayment,
  SupplierPaymentAllocation,
  Customer,
  DocumentRecord,
  InvoiceDraft,
  Job,
  JobPriority,
  JobStatus,
  LineItemInput,
  PaymentState,
  Role,
  ReminderState,
  Supplier,
  SupplierBill,
  SupplierBillLineItemInput,
  SupplierBillStatus,
  Team,
  TeamMembershipRole,
  User,
  UUID,
} from '../types/entities.js';
import { calculateTotals } from '../domain/invoices/gst.js';
import { formatInvoiceNumber } from '../domain/invoices/numbering.js';
import {
  TIMELINE_TAXONOMY,
  assertValidTimelineEventOrThrow,
  type TimelineEventKey,
} from '../domain/timeline/taxonomy.js';
import { assertValidJobStatusTransitionOrThrow } from '../domain/jobs/workflow.js';
import { assertValidPurchaseOrderStatusTransitionOrThrow } from '../domain/purchase-orders/workflow.js';
import { assertAssignmentInTeamScopeOrThrow } from '../domain/teams/assignment-scope.js';
import { assertTeamActionAuthorizedOrThrow } from '../domain/teams/authorization.js';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

interface DbInvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  gst_applicable: number;
}

interface DbInvoiceRow {
  id: string;
  customer_id: string;
  title: string;
  issue_date: string;
  due_date: string;
  notes: string | null;
  payment_terms: string | null;
  invoice_number: string | null;
  status: 'Draft' | 'Finalised';
  payment_state: PaymentState;
  reminder_state: ReminderState;
  subtotal: number;
  gst_total: number;
  total: number;
  created_at: string;
  updated_at: string;
}

interface DbCreditNoteRow {
  id: string;
  credit_note_number: string;
  linked_invoice_id: string;
  customer_id: string;
  issue_date: string;
  reason: string;
  type: CreditNoteType;
  status: 'Issued';
  total_credit: number;
  line_items_json: string;
  created_at: string;
  updated_at: string;
}

interface DbCustomerPaymentRow {
  id: string;
  payment_number: string;
  customer_id: string;
  payment_date: string;
  payment_method: string;
  reference: string;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DbSupplierRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DbSupplierBillRow {
  id: string;
  supplier_id: string;
  source_purchase_order_id: string | null;
  source_purchase_order_number?: string | null;
  bill_number: string | null;
  bill_date: string;
  due_date: string;
  supplier_reference: string | null;
  currency: string;
  notes: string | null;
  status: SupplierBillStatus;
  payment_state: PaymentState;
  subtotal: number;
  gst_total: number;
  total: number;
  created_at: string;
  updated_at: string;
}

interface DbSupplierPaymentRow {
  id: string;
  payment_number: string;
  supplier_id: string;
  payment_date: string;
  payment_method: string;
  reference: string;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DbSupplierBillLineItemRow {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  gst_applicable: number;
  source_purchase_order_line_item_id: string | null;
}

interface DbPurchaseOrderRow {
  id: string;
  purchase_order_number: string;
  supplier_id: string;
  issue_date: string;
  expected_delivery_date: string | null;
  supplier_reference: string | null;
  currency: string;
  notes: string | null;
  status: PurchaseOrderStatus;
  close_reason: string | null;
  closed_date: string | null;
  closed_by: string | null;
  subtotal: number;
  gst_total: number;
  total: number;
  created_at: string;
  updated_at: string;
}

interface DbPurchaseOrderLineItemRow {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  gst_applicable: number;
}

interface DbJobRow {
  id: string;
  job_number: string;
  title: string;
  description: string | null;
  customer_id: string;
  status: JobStatus;
  priority: JobPriority;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  team_id: string | null;
  completed_date: string | null;
  created_at: string;
  updated_at: string;
}

interface DbRoleRow {
  id: string;
  name: string;
  can_be_assigned: number;
  can_manage_assignments: number;
  created_at: string;
  updated_at: string;
}

interface DbUserRow {
  id: string;
  display_name: string;
  email: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface DbTeamRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerInput {
  displayName: string;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  abnTaxId?: string | undefined;
  notes?: string | undefined;
}

export type UpdateCustomerInput = CreateCustomerInput;

export interface CreateSupplierInput {
  displayName: string;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  taxId?: string | undefined;
  notes?: string | undefined;
}

export interface UpsertBusinessProfileInput {
  companyName: string;
  legalName?: string | undefined;
  abnTaxId?: string | undefined;
  address?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  logoReference?: string | undefined;
  primaryColor: string;
  secondaryColor: string;
}

export interface CreateInvoiceDraftInput {
  customerId: string;
  title: string;
  issueDate: string;
  dueDate: string;
  notes?: string | undefined;
  paymentTerms?: string | undefined;
  lineItems: LineItemInput[];
}

export interface CreateCreditNoteInput {
  linkedInvoiceId: string;
  issueDate: string;
  reason: string;
  type: CreditNoteType;
  lineItems?: CreditNoteLineItem[] | undefined;
  adjustmentAmount?: number | undefined;
}

export interface CreateCustomerPaymentInput {
  customerId: string;
  paymentDate: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  notes?: string | undefined;
  allocations: PaymentAllocation[];
}

export interface CreateSupplierBillDraftInput {
  supplierId: string;
  billDate: string;
  dueDate: string;
  supplierReference?: string | undefined;
  currency: string;
  notes?: string | undefined;
  lineItems: SupplierBillLineItemInput[];
}

export interface UpdateSupplierBillDraftInput {
  billDate: string;
  dueDate: string;
  supplierReference?: string | undefined;
  currency: string;
  notes?: string | undefined;
  lineItems: SupplierBillLineItemInput[];
}

export interface CreateSupplierPaymentInput {
  supplierId: string;
  paymentDate: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  notes?: string | undefined;
  allocations: SupplierPaymentAllocation[];
}

export interface CreatePurchaseOrderDraftInput {
  supplierId: string;
  issueDate: string;
  expectedDeliveryDate?: string | undefined;
  supplierReference?: string | undefined;
  currency: string;
  notes?: string | undefined;
  lineItems: PurchaseOrderLineItemInput[];
}

export interface UpdatePurchaseOrderDraftInput {
  issueDate: string;
  expectedDeliveryDate?: string | undefined;
  supplierReference?: string | undefined;
  currency: string;
  notes?: string | undefined;
  lineItems: PurchaseOrderLineItemInput[];
}

export interface CreateJobInput {
  title: string;
  description?: string | undefined;
  customerId: string;
  status: JobStatus;
  priority: JobPriority;
  scheduledStartAt?: string | undefined;
  scheduledEndAt?: string | undefined;
  assignedUserId?: string | undefined;
  assignedUserName?: string | undefined;
  teamId?: string | undefined;
  completedDate?: string | undefined;
}

export interface UpdateJobInput {
  title: string;
  description?: string | undefined;
  status: JobStatus;
  priority: JobPriority;
  scheduledStartAt?: string | null | undefined;
  scheduledEndAt?: string | null | undefined;
  assignedUserId?: string | null | undefined;
  assignedUserName?: string | null | undefined;
  teamId?: string | null | undefined;
  completedDate?: string | null | undefined;
}

export interface UpdateInvoiceDraftInput {
  title: string;
  issueDate: string;
  dueDate: string;
  notes?: string | undefined;
  paymentTerms?: string | undefined;
  lineItems: LineItemInput[];
  paymentState: PaymentState;
}

export interface CreateRoleInput {
  name: string;
  canBeAssigned?: boolean | undefined;
  canManageAssignments?: boolean | undefined;
}

export interface CreateUserInput {
  displayName: string;
  email?: string | undefined;
  isActive?: boolean | undefined;
  roleIds?: string[] | undefined;
}

export interface CreateTeamInput {
  name: string;
}

export interface TeamMembershipRecord {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMembershipRole;
  createdAt: string;
  user: User;
}

export interface SearchResults {
  customers: Customer[];
  invoices: InvoiceDraft[];
  documents: DocumentRecord[];
  jobs: Job[];
}

export interface ListCreditNotesFilter {
  customerId?: string;
  linkedInvoiceId?: string;
}

export interface ListCustomerPaymentsFilter {
  customerId?: string;
  invoiceId?: string;
  from?: string;
  to?: string;
}

export interface ListSupplierBillsFilter {
  supplierId?: string;
  sourcePurchaseOrderId?: string;
  billNumber?: string;
  fromBillDate?: string;
  toBillDate?: string;
  fromDueDate?: string;
  toDueDate?: string;
  status?: SupplierBillStatus;
  paymentState?: PaymentState;
}

export interface ListSupplierPaymentsFilter {
  supplierId?: string;
  supplierBillId?: string;
  from?: string;
  to?: string;
}

export interface ListPurchaseOrdersFilter {
  supplierId?: string;
  purchaseOrderNumber?: string;
  status?: PurchaseOrderStatus;
  billingStatus?: PurchaseOrderBillingStatus;
  fromIssueDate?: string;
  toIssueDate?: string;
  fromExpectedDeliveryDate?: string;
  toExpectedDeliveryDate?: string;
}

export interface CreateSupplierBillFromPurchaseOrderInput {
  lineItems?: Array<{
    purchaseOrderLineItemId: string;
    quantity: number;
  }> | undefined;
}

export interface ClosePurchaseOrderInput {
  closeReason?: string | undefined;
  closedDate?: string | undefined;
  closedBy?: string | undefined;
}

export interface JobDocumentLinkRecord {
  id: string;
  jobId: string;
  documentId: string;
  createdAt: string;
  document: DocumentRecord;
}

export interface CustomerStatementEntry {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  title: string;
  total: number;
}

export interface CustomerStatementReport {
  customer: Customer;
  generatedAt: string;
  period: {
    from: string | null;
    to: string | null;
  };
  openingBalance: number;
  periodTotal: number;
  closingBalance: number;
  entries: CustomerStatementEntry[];
  creditsSupported: false;
  creditsOmittedReason: string;
}

export interface AppDatabase {
  close(): void;
  createCustomer(input: CreateCustomerInput): Customer;
  updateCustomer(id: string, input: UpdateCustomerInput): Customer;
  getCustomerById(id: string): Customer | null;
  createSupplier(input: CreateSupplierInput): Supplier;
  getSupplierById(id: string): Supplier | null;
  listSuppliers(): Supplier[];
  upsertBusinessProfile(input: UpsertBusinessProfileInput): BrandingProfile;
  getBusinessProfile(): BrandingProfile | null;
  upsertPreference(key: string, value: unknown): void;
  getPreference(key: string): unknown;
  createInvoiceDraft(input: CreateInvoiceDraftInput): InvoiceDraft;
  updateInvoiceDraft(id: string, input: UpdateInvoiceDraftInput): InvoiceDraft;
  getInvoiceById(id: string): (InvoiceDraft & { lineItems: LineItemInput[] }) | null;
  finaliseInvoice(id: string): InvoiceDraft;
  createCreditNote(input: CreateCreditNoteInput): CreditNote;
  getCreditNoteById(id: string): CreditNote | null;
  listCreditNotes(filter?: ListCreditNotesFilter): CreditNote[];
  createCustomerPayment(input: CreateCustomerPaymentInput): CustomerPayment;
  getCustomerPaymentById(id: string): CustomerPayment | null;
  listCustomerPayments(filter?: ListCustomerPaymentsFilter): CustomerPayment[];
  createSupplierBillDraft(input: CreateSupplierBillDraftInput): SupplierBill;
  createSupplierBillDraftFromPurchaseOrder(
    purchaseOrderId: string,
    input?: CreateSupplierBillFromPurchaseOrderInput,
  ): SupplierBill;
  updateSupplierBillDraft(id: string, input: UpdateSupplierBillDraftInput): SupplierBill;
  getSupplierBillById(id: string): (SupplierBill & { lineItems: SupplierBillLineItemInput[] }) | null;
  finaliseSupplierBill(id: string): SupplierBill;
  listSupplierBills(filter?: ListSupplierBillsFilter): SupplierBill[];
  createSupplierPayment(input: CreateSupplierPaymentInput): SupplierBillPayment;
  getSupplierPaymentById(id: string): SupplierBillPayment | null;
  listSupplierPayments(filter?: ListSupplierPaymentsFilter): SupplierBillPayment[];
  createPurchaseOrderDraft(input: CreatePurchaseOrderDraftInput): PurchaseOrder;
  updatePurchaseOrderDraft(id: string, input: UpdatePurchaseOrderDraftInput): PurchaseOrder;
  getPurchaseOrderById(id: string): (PurchaseOrder & { lineItems: PurchaseOrderLineItemInput[] }) | null;
  approvePurchaseOrder(id: string): PurchaseOrder;
  closePurchaseOrder(id: string, input?: ClosePurchaseOrderInput): PurchaseOrder;
  cancelPurchaseOrder(id: string): PurchaseOrder;
  listPurchaseOrders(filter?: ListPurchaseOrdersFilter): PurchaseOrder[];
  createRole(input: CreateRoleInput): Role;
  getRoleById(id: string): Role | null;
  listRoles(): Role[];
  createUser(input: CreateUserInput): User;
  getUserById(id: string): User | null;
  listUsers(): User[];
  createTeam(input: CreateTeamInput): Team;
  getTeamById(id: string): Team | null;
  listTeams(): Team[];
  deleteTeam(teamId: string, actorUserId?: string | null): void;
  addTeamMember(
    teamId: string,
    userId: string,
    role?: TeamMembershipRole,
    actorUserId?: string | null,
  ): TeamMembershipRecord;
  removeTeamMember(teamId: string, userId: string, actorUserId?: string | null): void;
  updateTeamMemberRole(
    teamId: string,
    userId: string,
    role: TeamMembershipRole,
    actorUserId?: string | null,
  ): TeamMembershipRecord;
  listTeamMembers(teamId: string): TeamMembershipRecord[];
  createJob(input: CreateJobInput): Job;
  updateJob(id: string, input: UpdateJobInput): Job;
  getJobById(id: string): Job | null;
  listJobs(): Job[];
  linkDocumentToJob(jobId: string, documentId: string): JobDocumentLinkRecord;
  listJobDocuments(jobId: string): JobDocumentLinkRecord[];
  getCustomerStatement(customerId: string, from?: string | null, to?: string | null): CustomerStatementReport;
  getTimelineForEntity(entityType: string, entityId: string): Array<Record<string, unknown>>;
  search(query: string): SearchResults;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapCustomerRow(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    abnTaxId: (row.abn_tax_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSupplierRow(row: DbSupplierRow): Supplier {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    taxId: row.tax_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvoiceRow(row: DbInvoiceRow): InvoiceDraft {
  return {
    id: row.id,
    customerId: row.customer_id,
    title: row.title,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    notes: row.notes,
    paymentTerms: row.payment_terms,
    invoiceNumber: row.invoice_number,
    status: row.status,
    paymentState: row.payment_state,
    reminderState: row.reminder_state,
    totals: {
      subtotal: row.subtotal,
      gstTotal: row.gst_total,
      total: row.total,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCreditNoteRow(row: DbCreditNoteRow): CreditNote {
  return {
    id: row.id,
    creditNoteNumber: row.credit_note_number,
    linkedInvoiceId: row.linked_invoice_id,
    customerId: row.customer_id,
    issueDate: row.issue_date,
    reason: row.reason,
    type: row.type,
    status: row.status,
    totalCredit: row.total_credit,
    lineItems: JSON.parse(row.line_items_json) as CreditNoteLineItem[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplierBillRow(row: DbSupplierBillRow): SupplierBill {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    sourcePurchaseOrderId: row.source_purchase_order_id,
    sourcePurchaseOrderNumber: row.source_purchase_order_number ?? null,
    billNumber: row.bill_number,
    billDate: row.bill_date,
    dueDate: row.due_date,
    supplierReference: row.supplier_reference,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    paymentState: row.payment_state,
    totals: {
      subtotal: row.subtotal,
      gstTotal: row.gst_total,
      total: row.total,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplierPaymentRow(
  row: DbSupplierPaymentRow,
  allocations: SupplierPaymentAllocation[],
): SupplierBillPayment {
  return {
    id: row.id,
    paymentNumber: row.payment_number,
    supplierId: row.supplier_id,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    reference: row.reference,
    amount: row.amount,
    notes: row.notes,
    allocations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPurchaseOrderRow(row: DbPurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    purchaseOrderNumber: row.purchase_order_number,
    supplierId: row.supplier_id,
    issueDate: row.issue_date,
    expectedDeliveryDate: row.expected_delivery_date,
    supplierReference: row.supplier_reference,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    closeReason: row.close_reason,
    closedDate: row.closed_date,
    closedBy: row.closed_by,
    billingStatus: 'unbilled',
    totalBilledAmount: 0,
    remainingUnbilledAmount: row.total,
    totals: {
      subtotal: row.subtotal,
      gstTotal: row.gst_total,
      total: row.total,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCustomerPaymentRow(
  row: DbCustomerPaymentRow,
  allocations: PaymentAllocation[],
): CustomerPayment {
  return {
    id: row.id,
    paymentNumber: row.payment_number,
    customerId: row.customer_id,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    reference: row.reference,
    amount: row.amount,
    notes: row.notes,
    allocations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJobRow(row: DbJobRow): Job {
  return {
    id: row.id,
    jobNumber: row.job_number,
    title: row.title,
    description: row.description,
    customerId: row.customer_id,
    status: row.status,
    priority: row.priority,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    teamId: row.team_id,
    completedDate: row.completed_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoleRow(row: DbRoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    canBeAssigned: row.can_be_assigned === 1,
    canManageAssignments: row.can_manage_assignments === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBusinessProfileRow(row: Record<string, unknown>): BrandingProfile {
  return {
    id: String(row.id),
    companyName: String(row.company_name),
    legalName: (row.legal_name as string | null) ?? null,
    abnTaxId: (row.abn_tax_id as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    logoReference: (row.logo_reference as string | null) ?? null,
    primaryColor: String(row.primary_color),
    secondaryColor: String(row.secondary_color),
    updatedAt: String(row.updated_at),
  };
}

function mapUserRow(row: DbUserRow, roleIds: string[]): User {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    isActive: row.is_active === 1,
    roleIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTeamRow(row: DbTeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(schemaSql);

  const jobColumns = db.prepare("SELECT name FROM pragma_table_info('jobs')").all() as Array<{
    name: string;
  }>;
  const jobColumnSet = new Set(jobColumns.map((column) => column.name));
  if (!jobColumnSet.has('scheduled_start_at')) {
    db.exec('ALTER TABLE jobs ADD COLUMN scheduled_start_at TEXT;');
  }
  if (!jobColumnSet.has('scheduled_end_at')) {
    db.exec('ALTER TABLE jobs ADD COLUMN scheduled_end_at TEXT;');
  }
  if (!jobColumnSet.has('assigned_user_id')) {
    db.exec('ALTER TABLE jobs ADD COLUMN assigned_user_id TEXT;');
  }
  if (!jobColumnSet.has('assigned_user_name')) {
    db.exec('ALTER TABLE jobs ADD COLUMN assigned_user_name TEXT;');
  }
  if (!jobColumnSet.has('team_id')) {
    db.exec('ALTER TABLE jobs ADD COLUMN team_id TEXT;');
  }
  if (jobColumnSet.has('scheduled_date')) {
    db.exec(
      `UPDATE jobs
       SET scheduled_start_at = coalesce(scheduled_start_at, scheduled_date)
       WHERE scheduled_start_at IS NULL AND scheduled_date IS NOT NULL`,
    );
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_start ON jobs(scheduled_start_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_assigned_user ON jobs(assigned_user_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_team ON jobs(team_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_team_assigned_user ON jobs(team_id, assigned_user_id);');

  const teamMembershipColumns = db
    .prepare("SELECT name FROM pragma_table_info('team_memberships')")
    .all() as Array<{ name: string }>;
  const teamMembershipColumnSet = new Set(teamMembershipColumns.map((column) => column.name));
  if (!teamMembershipColumnSet.has('role')) {
    db.exec("ALTER TABLE team_memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'member';");
  }
  db.exec("UPDATE team_memberships SET role = 'member' WHERE role IS NULL;");
  db.exec(
    `UPDATE team_memberships
     SET role = 'owner'
     WHERE id IN (
       SELECT tm.id
       FROM team_memberships tm
       INNER JOIN (
         SELECT team_id, min(created_at) AS first_created_at
         FROM team_memberships
         GROUP BY team_id
       ) first_membership
         ON first_membership.team_id = tm.team_id
        AND first_membership.first_created_at = tm.created_at
       WHERE tm.team_id IN (
         SELECT tm2.team_id
         FROM team_memberships tm2
         GROUP BY tm2.team_id
         HAVING sum(CASE WHEN tm2.role = 'owner' THEN 1 ELSE 0 END) = 0
       )
     );`,
  );

  const supplierBillColumns = db
    .prepare("SELECT name FROM pragma_table_info('supplier_bills')")
    .all() as Array<{ name: string }>;
  const supplierBillColumnSet = new Set(supplierBillColumns.map((column) => column.name));
  if (!supplierBillColumnSet.has('source_purchase_order_id')) {
    db.exec('ALTER TABLE supplier_bills ADD COLUMN source_purchase_order_id TEXT;');
  }
  db.exec('DROP INDEX IF EXISTS uq_supplier_bills_source_purchase_order_not_null;');
  const supplierBillLineItemColumns = db
    .prepare("SELECT name FROM pragma_table_info('supplier_bill_line_items')")
    .all() as Array<{ name: string }>;
  const supplierBillLineItemColumnSet = new Set(supplierBillLineItemColumns.map((column) => column.name));
  if (!supplierBillLineItemColumnSet.has('source_purchase_order_line_item_id')) {
    db.exec('ALTER TABLE supplier_bill_line_items ADD COLUMN source_purchase_order_line_item_id TEXT;');
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_items_source_po_line
     ON supplier_bill_line_items(source_purchase_order_line_item_id);`,
  );
  if (!supplierBillColumnSet.has('payment_state')) {
    db.exec("ALTER TABLE supplier_bills ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'Draft';");
  }
  db.exec(
    `UPDATE supplier_bills
     SET payment_state = CASE
       WHEN status = 'Finalised' THEN 'Awaiting Payment'
       ELSE 'Draft'
     END
     WHERE payment_state IS NULL`,
  );

  const purchaseOrderColumns = db
    .prepare("SELECT name FROM pragma_table_info('purchase_orders')")
    .all() as Array<{ name: string }>;
  const purchaseOrderColumnSet = new Set(purchaseOrderColumns.map((column) => column.name));
  if (!purchaseOrderColumnSet.has('close_reason')) {
    db.exec('ALTER TABLE purchase_orders ADD COLUMN close_reason TEXT;');
  }
  if (!purchaseOrderColumnSet.has('closed_date')) {
    db.exec('ALTER TABLE purchase_orders ADD COLUMN closed_date TEXT;');
  }
  if (!purchaseOrderColumnSet.has('closed_by')) {
    db.exec('ALTER TABLE purchase_orders ADD COLUMN closed_by TEXT;');
  }

  const timelineColumns = db
    .prepare("SELECT name FROM pragma_table_info('timeline_events')")
    .all() as Array<{ name: string }>;
  const timelineColumnSet = new Set(timelineColumns.map((column) => column.name));
  if (!timelineColumnSet.has('event_key')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN event_key TEXT;');
  }
  if (!timelineColumnSet.has('event_version')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN event_version INTEGER;');
  }
  if (!timelineColumnSet.has('category')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN category TEXT;');
  }
  if (!timelineColumnSet.has('actor_type')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN actor_type TEXT;');
  }
  if (!timelineColumnSet.has('source')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN source TEXT;');
  }
  if (!timelineColumnSet.has('payload_schema')) {
    db.exec('ALTER TABLE timeline_events ADD COLUMN payload_schema TEXT;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_timeline_event_key ON timeline_events(event_key);');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_timeline_events_taxonomy_insert
    BEFORE INSERT ON timeline_events
    WHEN NEW.event_key IS NULL
    OR NEW.event_version IS NULL
    OR NEW.category IS NULL
    OR NEW.actor_type IS NULL
    OR NEW.source IS NULL
    OR NEW.payload_schema IS NULL
    OR NEW.event_version <> 1
    OR NEW.event_key NOT IN (
      'document.created',
      'document.updated',
      'invoice.draft_created',
      'invoice.draft_updated',
      'invoice.finalised',
      'credit_note.created',
      'payment.created',
      'payment.allocated',
      'supplier_payment.created',
      'supplier_payment.allocated',
      'purchase_order.created',
      'purchase_order.approved',
      'purchase_order.closed',
      'purchase_order.cancelled',
      'purchase_order.partially_billed',
      'purchase_order.fully_billed',
      'supplier_bill.created_from_purchase_order',
      'supplier_bill.created',
      'supplier_bill.finalised',
      'customer.created',
      'customer.updated',
      'business_profile.updated',
      'preferences.updated',
      'job.created',
      'job.updated',
      'job.completed',
      'job.document_linked',
      'document.linked_to_job',
      'job.scheduled',
      'job.assignment_updated',
      'job.status_changed',
      'team.created',
      'team.member_added',
      'team.member_removed',
      'team.deleted',
      'job.assignment_scope_set'
    )
    BEGIN
      SELECT RAISE(ABORT, 'INVALID_TIMELINE_EVENT_TAXONOMY');
    END;
  `);

  const insertTimeline = db.prepare(
    `INSERT INTO timeline_events (
      id,
      event_key,
      event_version,
      category,
      entity_type,
      entity_id,
      actor_type,
      source,
      event_type,
      event_payload,
      payload_schema,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function timeline(eventKey: TimelineEventKey, entityId: string, payload: unknown): void {
    const definition = TIMELINE_TAXONOMY[eventKey];
    assertValidTimelineEventOrThrow(definition.key, definition.version);
    insertTimeline.run(
      randomUUID(),
      definition.key,
      definition.version,
      definition.category,
      definition.entityType,
      entityId,
      definition.actorType,
      definition.source,
      definition.legacyEventType,
      JSON.stringify(payload),
      definition.payloadSchema,
      nowIso(),
    );
  }

  function upsertDocument(id: UUID, title: string, type: string, searchableText: string): void {
    const now = nowIso();
    const existing = db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id) as
      | { 1: number }
      | undefined;
    db.prepare(
      `INSERT INTO documents (id, document_type, title, entity_id, searchable_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         searchable_text = excluded.searchable_text,
         updated_at = excluded.updated_at`,
    ).run(id, type, title, id, searchableText, now, now);

    if (existing) {
      timeline('document.updated', id, {
        documentType: type,
        title,
      });
    } else {
      timeline('document.created', id, {
        documentType: type,
        title,
      });
    }
  }

  const listRoleIdsForUser = db.prepare(
    'SELECT role_id FROM user_role_links WHERE user_id = ? ORDER BY created_at ASC',
  );

  function getRoleIdsForUser(userId: string): string[] {
    const rows = listRoleIdsForUser.all(userId) as Array<{ role_id: string }>;
    return rows.map((row) => row.role_id);
  }

  function getAllocationsForPayment(paymentId: string): PaymentAllocation[] {
    const rows = db
      .prepare(
        `SELECT invoice_id, amount
         FROM payment_allocations
         WHERE payment_id = ?
         ORDER BY created_at ASC`,
      )
      .all(paymentId) as Array<{ invoice_id: string; amount: number }>;
    return rows.map((row) => ({
      invoiceId: row.invoice_id,
      amount: row.amount,
    }));
  }

  function getAllocationsForSupplierPayment(supplierPaymentId: string): SupplierPaymentAllocation[] {
    const rows = db
      .prepare(
        `SELECT supplier_bill_id, amount
         FROM supplier_payment_allocations
         WHERE supplier_payment_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierPaymentId) as Array<{ supplier_bill_id: string; amount: number }>;
    return rows.map((row) => ({
      supplierBillId: row.supplier_bill_id,
      amount: row.amount,
    }));
  }

  function getPurchaseOrderBillingSummary(purchaseOrderId: string, purchaseOrderTotal: number): {
    totalBilledAmount: number;
    remainingUnbilledAmount: number;
    billingStatus: PurchaseOrderBillingStatus;
  } {
    const billedRow = db
      .prepare(
        `SELECT coalesce(sum(total), 0) AS total
         FROM supplier_bills
         WHERE source_purchase_order_id = ?`,
      )
      .get(purchaseOrderId) as { total: number };
    const totalBilledAmount = Number(billedRow.total ?? 0);
    const remainingUnbilledAmount = Math.max(purchaseOrderTotal - totalBilledAmount, 0);
    let billingStatus: PurchaseOrderBillingStatus = 'unbilled';
    if (totalBilledAmount > 0 && remainingUnbilledAmount > 0) {
      billingStatus = 'partially_billed';
    } else if (totalBilledAmount > 0 && remainingUnbilledAmount <= 0) {
      billingStatus = 'fully_billed';
    }
    return {
      totalBilledAmount,
      remainingUnbilledAmount,
      billingStatus,
    };
  }

  function withPurchaseOrderBillingSummary<T extends PurchaseOrder>(purchaseOrder: T): T {
    const summary = getPurchaseOrderBillingSummary(purchaseOrder.id, purchaseOrder.totals.total);
    return {
      ...purchaseOrder,
      ...summary,
    };
  }

  function loadAssignableUserOrThrow(
    assignedUserId: string,
    assignedUserName: string | null,
  ): { userId: string; userName: string } {
    const user = db
      .prepare('SELECT id, display_name, is_active FROM users WHERE id = ?')
      .get(assignedUserId) as { id: string; display_name: string; is_active: number } | undefined;
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    if (user.is_active !== 1) {
      throw new Error('ASSIGNED_USER_INACTIVE');
    }
    if (assignedUserName && assignedUserName !== user.display_name) {
      throw new Error('ASSIGNED_USER_NAME_MISMATCH');
    }

    const assignableRoleCount = db
      .prepare(
        `SELECT count(*) AS count
         FROM user_role_links url
         INNER JOIN roles r ON r.id = url.role_id
         WHERE url.user_id = ? AND r.can_be_assigned = 1`,
      )
      .get(assignedUserId) as { count: number };
    if (assignableRoleCount.count < 1) {
      throw new Error('ASSIGNED_USER_ROLE_REQUIRED');
    }

    return {
      userId: user.id,
      userName: user.display_name,
    };
  }

  function ensureTeamExistsOrThrow(teamId: string): void {
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) {
      throw new Error('TEAM_NOT_FOUND');
    }
  }

  function isUserInTeam(teamId: string, userId: string): boolean {
    const row = db
      .prepare('SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?')
      .get(teamId, userId) as { 1: number } | undefined;
    return Boolean(row);
  }

  function assertValidTeamMembershipRoleOrThrow(role: string): asserts role is TeamMembershipRole {
    if (role !== 'owner' && role !== 'manager' && role !== 'member') {
      throw new Error('INVALID_TEAM_MEMBER_ROLE');
    }
  }

  function getTeamMembershipCount(teamId: string): number {
    const row = db
      .prepare(
        `SELECT COUNT(1) AS total
         FROM team_memberships
         WHERE team_id = ?`,
      )
      .get(teamId) as { total: number };
    return row.total;
  }

  function getOwnerCountForTeam(teamId: string): number {
    const row = db
      .prepare(
        `SELECT COUNT(1) AS total
         FROM team_memberships
         WHERE team_id = ? AND role = 'owner'`,
      )
      .get(teamId) as { total: number };
    return row.total;
  }

  function getMembershipRole(teamId: string, userId: string): TeamMembershipRole | null {
    const row = db
      .prepare(
        `SELECT role
         FROM team_memberships
         WHERE team_id = ? AND user_id = ?`,
      )
      .get(teamId, userId) as { role: string } | undefined;
    if (!row) {
      return null;
    }
    assertValidTeamMembershipRoleOrThrow(row.role);
    return row.role;
  }

  function assertAuthorizedForTeamActionOrThrow(
    teamId: string,
    actorUserId: string | null,
    action: 'add_member' | 'remove_member' | 'change_member_role' | 'delete_team',
    targetRole?: TeamMembershipRole | null,
    nextRole?: TeamMembershipRole | null,
  ): void {
    if (!actorUserId) {
      throw new Error('TEAM_PERMISSION_DENIED');
    }
    const actorRole = getMembershipRole(teamId, actorUserId);
    if (!actorRole) {
      throw new Error('TEAM_PERMISSION_DENIED');
    }
    assertTeamActionAuthorizedOrThrow({
      action,
      actorRole,
      targetRole: targetRole ?? null,
      nextRole: nextRole ?? null,
    });
  }

  return {
    close() {
      db.close();
    },

    createCustomer(input) {
      const id = randomUUID();
      const now = nowIso();
      db.prepare(
        `INSERT INTO customers (id, display_name, email, phone, address, abn_tax_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.displayName,
        input.email ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.abnTaxId ?? null,
        input.notes ?? null,
        now,
        now,
      );
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown>;
      timeline('customer.created', id, { displayName: input.displayName });
      return mapCustomerRow(row);
    },

    updateCustomer(id, input) {
      const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
      if (!existing) {
        throw new Error('Customer not found');
      }

      db.prepare(
        `UPDATE customers
         SET display_name = ?, email = ?, phone = ?, address = ?, abn_tax_id = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.displayName,
        input.email ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.abnTaxId ?? null,
        input.notes ?? null,
        nowIso(),
        id,
      );
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown>;
      timeline('customer.updated', id, { displayName: input.displayName });
      return mapCustomerRow(row);
    },

    getCustomerById(id) {
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? mapCustomerRow(row) : null;
    },

    createSupplier(input) {
      const id = randomUUID();
      const now = nowIso();
      db.prepare(
        `INSERT INTO suppliers (id, display_name, email, phone, address, tax_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.displayName,
        input.email ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.taxId ?? null,
        input.notes ?? null,
        now,
        now,
      );
      const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as DbSupplierRow;
      return mapSupplierRow(row);
    },

    getSupplierById(id) {
      const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as DbSupplierRow | undefined;
      return row ? mapSupplierRow(row) : null;
    },

    listSuppliers() {
      const rows = db
        .prepare('SELECT * FROM suppliers ORDER BY created_at DESC')
        .all() as DbSupplierRow[];
      return rows.map(mapSupplierRow);
    },

    upsertBusinessProfile(input) {
      const profileId = 'business-profile';
      const now = nowIso();
      db.prepare(
        `INSERT INTO business_profile (id, company_name, legal_name, abn_tax_id, address, email, phone, logo_reference, primary_color, secondary_color, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           company_name = excluded.company_name,
           legal_name = excluded.legal_name,
           abn_tax_id = excluded.abn_tax_id,
           address = excluded.address,
           email = excluded.email,
           phone = excluded.phone,
           logo_reference = excluded.logo_reference,
           primary_color = excluded.primary_color,
           secondary_color = excluded.secondary_color,
           updated_at = excluded.updated_at`,
      ).run(
        profileId,
        input.companyName,
        input.legalName ?? null,
        input.abnTaxId ?? null,
        input.address ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.logoReference ?? null,
        input.primaryColor,
        input.secondaryColor,
        now,
      );

      const row = db.prepare('SELECT * FROM business_profile WHERE id = ?').get(profileId) as Record<
        string,
        unknown
      >;
      timeline('business_profile.updated', profileId, {
        companyName: input.companyName,
      });
      return mapBusinessProfileRow(row);
    },

    getBusinessProfile() {
      const row = db.prepare('SELECT * FROM business_profile WHERE id = ?').get('business-profile') as
        | Record<string, unknown>
        | undefined;
      return row ? mapBusinessProfileRow(row) : null;
    },

    upsertPreference(key, value) {
      db.prepare(
        `INSERT INTO preferences (id, preference_key, value_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(preference_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at`,
      ).run(randomUUID(), key, JSON.stringify(value), nowIso());
      timeline('preferences.updated', key, { key });
    },

    getPreference(key) {
      const row = db
        .prepare('SELECT value_json FROM preferences WHERE preference_key = ?')
        .get(key) as { value_json: string } | undefined;
      return row ? (JSON.parse(row.value_json) as unknown) : null;
    },

    createInvoiceDraft(input) {
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }
      const id = randomUUID();
      const now = nowIso();
      const { totals } = calculateTotals(input.lineItems);

      db.prepare(
        `INSERT INTO invoices (id, customer_id, title, issue_date, due_date, notes, payment_terms, invoice_number, status, payment_state, reminder_state, subtotal, gst_total, total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.customerId,
        input.title,
        input.issueDate,
        input.dueDate,
        input.notes ?? null,
        input.paymentTerms ?? null,
        null,
        'Draft',
        'Draft',
        'None',
        totals.subtotal,
        totals.gstTotal,
        totals.total,
        now,
        now,
      );

      const insertLine = db.prepare(
        `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const { calculatedItems } = calculateTotals(input.lineItems);
      for (const item of calculatedItems) {
        insertLine.run(
          randomUUID(),
          id,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      upsertDocument(id, input.title, 'invoice', `${input.title} ${input.notes ?? ''}`);
      timeline('invoice.draft_created', id, { totals, lineItems: input.lineItems.length });

      const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as DbInvoiceRow;
      return mapInvoiceRow(row);
    },

    updateInvoiceDraft(id, input) {
      const existing = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id) as
        | { status: string }
        | undefined;
      if (!existing) {
        throw new Error('Invoice not found');
      }
      if (existing.status !== 'Draft') {
        throw new Error('Only draft invoices can be edited');
      }

      const { totals } = calculateTotals(input.lineItems);
      db.prepare(
        `UPDATE invoices
         SET title = ?, issue_date = ?, due_date = ?, notes = ?, payment_terms = ?, payment_state = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.title,
        input.issueDate,
        input.dueDate,
        input.notes ?? null,
        input.paymentTerms ?? null,
        input.paymentState,
        totals.subtotal,
        totals.gstTotal,
        totals.total,
        nowIso(),
        id,
      );

      db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(id);
      const insertLine = db.prepare(
        `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const { calculatedItems } = calculateTotals(input.lineItems);
      for (const item of calculatedItems) {
        insertLine.run(
          randomUUID(),
          id,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      upsertDocument(id, input.title, 'invoice', `${input.title} ${input.notes ?? ''}`);
      timeline('invoice.draft_updated', id, { totals, lineItems: input.lineItems.length });

      const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as DbInvoiceRow;
      return mapInvoiceRow(row);
    },

    getInvoiceById(id) {
      const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as DbInvoiceRow | undefined;
      if (!row) {
        return null;
      }
      const lineItemsRows = db
        .prepare(
          'SELECT description, quantity, unit_price, gst_applicable FROM invoice_line_items WHERE invoice_id = ?',
        )
        .all(id) as DbInvoiceLineItem[];

      const lineItems: LineItemInput[] = lineItemsRows.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        gstApplicable: item.gst_applicable === 1,
      }));

      return {
        ...mapInvoiceRow(row),
        lineItems,
      };
    },

    finaliseInvoice(id) {
      const invoice = this.getInvoiceById(id);
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      if (invoice.status !== 'Draft') {
        throw new Error('Invoice already finalised');
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM invoice_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;

      let prefix = 'INV';
      let sequence = 1;

      if (!sequenceRow) {
        db.prepare('INSERT INTO invoice_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE invoice_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE invoice_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const invoiceNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();
      upsertDocument(
        id,
        `${invoiceNumber} ${invoice.title}`,
        'invoice',
        `${invoiceNumber} ${invoice.title} ${invoice.notes ?? ''}`,
      );
      db.prepare(
        `UPDATE invoices
         SET status = 'Finalised', invoice_number = ?, payment_state = 'Awaiting Payment', updated_at = ?
         WHERE id = ?`,
      ).run(invoiceNumber, now, id);

      const finalised = this.getInvoiceById(id);
      if (!finalised) {
        throw new Error('Failed to load finalised invoice');
      }

      db.prepare(
        `INSERT INTO invoice_snapshots (id, invoice_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(randomUUID(), id, JSON.stringify(finalised), now);

      timeline('invoice.finalised', id, {
        invoiceNumber,
        total: finalised.totals.total,
      });

      return finalised;
    },

    createCreditNote(input) {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(input.linkedInvoiceId) as
        | DbInvoiceRow
        | undefined;
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      if (invoice.status !== 'Finalised') {
        throw new Error('CREDIT_NOTE_REQUIRES_FINALISED_INVOICE');
      }
      if (invoice.payment_state === 'Cancelled') {
        throw new Error('CREDIT_NOTE_FOR_CANCELLED_INVOICE_FORBIDDEN');
      }

      let lineItems: CreditNoteLineItem[] = [];
      let totalCredit = 0;

      if (input.type === 'Full') {
        const existingFullCredit = db
          .prepare(
            `SELECT COUNT(1) AS total
             FROM credit_notes
             WHERE linked_invoice_id = ? AND type = 'Full' AND status = 'Issued'`,
          )
          .get(input.linkedInvoiceId) as { total: number };
        if (existingFullCredit.total > 0) {
          throw new Error('CREDIT_NOTE_FULL_ALREADY_EXISTS');
        }
        totalCredit = invoice.total;
        lineItems = [
          {
            description: `Full credit for ${invoice.invoice_number ?? invoice.id}`,
            amount: invoice.total,
          },
        ];
      } else {
        if (input.lineItems && input.lineItems.length > 0) {
          lineItems = input.lineItems;
        } else if (input.adjustmentAmount && input.adjustmentAmount > 0) {
          lineItems = [
            {
              description: 'Partial credit adjustment',
              amount: input.adjustmentAmount,
            },
          ];
        } else {
          throw new Error('CREDIT_NOTE_PARTIAL_AMOUNT_REQUIRED');
        }
        totalCredit = lineItems.reduce((sum, item) => sum + item.amount, 0);
      }

      if (totalCredit <= 0) {
        throw new Error('CREDIT_NOTE_AMOUNT_INVALID');
      }
      if (totalCredit > invoice.total) {
        throw new Error('CREDIT_NOTE_AMOUNT_EXCEEDS_INVOICE_TOTAL');
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM credit_note_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;
      let prefix = 'CRN';
      let sequence = 1;
      if (!sequenceRow) {
        db.prepare('INSERT INTO credit_note_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE credit_note_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE credit_note_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const id = randomUUID();
      const creditNoteNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();
      db.prepare(
        `INSERT INTO credit_notes (
          id,
          credit_note_number,
          linked_invoice_id,
          customer_id,
          issue_date,
          reason,
          type,
          status,
          total_credit,
          line_items_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        creditNoteNumber,
        input.linkedInvoiceId,
        invoice.customer_id,
        input.issueDate,
        input.reason,
        input.type,
        'Issued',
        totalCredit,
        JSON.stringify(lineItems),
        now,
        now,
      );

      upsertDocument(
        id,
        `${creditNoteNumber} ${input.reason}`,
        'custom',
        `${creditNoteNumber} ${input.reason} ${invoice.invoice_number ?? input.linkedInvoiceId}`,
      );
      timeline('credit_note.created', id, {
        linkedInvoiceId: input.linkedInvoiceId,
        type: input.type,
        totalCredit,
      });

      const row = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(id) as DbCreditNoteRow;
      return mapCreditNoteRow(row);
    },

    getCreditNoteById(id) {
      const row = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(id) as DbCreditNoteRow | undefined;
      return row ? mapCreditNoteRow(row) : null;
    },

    listCreditNotes(filter) {
      const rowFilter = filter ?? {};
      const rows = db
        .prepare(
          `SELECT * FROM credit_notes
           WHERE (? IS NULL OR customer_id = ?)
             AND (? IS NULL OR linked_invoice_id = ?)
           ORDER BY issue_date DESC, created_at DESC`,
        )
        .all(
          rowFilter.customerId ?? null,
          rowFilter.customerId ?? null,
          rowFilter.linkedInvoiceId ?? null,
          rowFilter.linkedInvoiceId ?? null,
        ) as DbCreditNoteRow[];
      return rows.map(mapCreditNoteRow);
    },

    createCustomerPayment(input) {
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }
      if (input.allocations.length === 0) {
        throw new Error('PAYMENT_ALLOCATIONS_REQUIRED');
      }

      const allocationInvoiceSet = new Set(input.allocations.map((allocation) => allocation.invoiceId));
      if (allocationInvoiceSet.size !== input.allocations.length) {
        throw new Error('PAYMENT_DUPLICATE_ALLOCATION_INVOICE');
      }

      const allocationTotal = input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      if (allocationTotal > input.amount) {
        throw new Error('PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT');
      }

      for (const allocation of input.allocations) {
        if (allocation.amount <= 0) {
          throw new Error('PAYMENT_ALLOCATION_AMOUNT_INVALID');
        }

        const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(allocation.invoiceId) as
          | DbInvoiceRow
          | undefined;
        if (!invoice) {
          throw new Error('Invoice not found');
        }
        if (invoice.status !== 'Finalised') {
          throw new Error('PAYMENT_ALLOCATION_REQUIRES_FINALISED_INVOICE');
        }
        if (invoice.customer_id !== input.customerId) {
          throw new Error('PAYMENT_ALLOCATION_CUSTOMER_MISMATCH');
        }
        if (invoice.payment_state === 'Cancelled') {
          throw new Error('PAYMENT_ALLOCATION_FOR_CANCELLED_INVOICE_FORBIDDEN');
        }

        const existingAllocated = db
          .prepare(
            `SELECT coalesce(sum(pa.amount), 0) AS total
             FROM payment_allocations pa
             WHERE pa.invoice_id = ?`,
          )
          .get(allocation.invoiceId) as { total: number };

        const outstanding = invoice.total - existingAllocated.total;
        if (allocation.amount > outstanding) {
          throw new Error('PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING');
        }
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM payment_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;

      let prefix = 'PAY';
      let sequence = 1;
      if (!sequenceRow) {
        db.prepare('INSERT INTO payment_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE payment_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE payment_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const id = randomUUID();
      const paymentNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();

      db.prepare(
        `INSERT INTO customer_payments (
          id,
          payment_number,
          customer_id,
          payment_date,
          payment_method,
          reference,
          amount,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        paymentNumber,
        input.customerId,
        input.paymentDate,
        input.paymentMethod,
        input.reference,
        input.amount,
        input.notes ?? null,
        now,
        now,
      );

      const insertAllocation = db.prepare(
        `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const allocation of input.allocations) {
        insertAllocation.run(randomUUID(), id, allocation.invoiceId, allocation.amount, now);
      }

      for (const allocation of input.allocations) {
        const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(allocation.invoiceId) as DbInvoiceRow;
        const totalAllocated = db
          .prepare(
            `SELECT coalesce(sum(pa.amount), 0) AS total
             FROM payment_allocations pa
             WHERE pa.invoice_id = ?`,
          )
          .get(allocation.invoiceId) as { total: number };
        const nextState: PaymentState = totalAllocated.total >= invoice.total ? 'Paid' : 'Awaiting Payment';
        db.prepare('UPDATE invoices SET payment_state = ?, updated_at = ? WHERE id = ?').run(
          nextState,
          nowIso(),
          allocation.invoiceId,
        );
      }

      upsertDocument(
        id,
        `${paymentNumber} ${input.reference}`,
        'receipt',
        `${paymentNumber} ${input.paymentMethod} ${input.reference} ${input.notes ?? ''}`,
      );
      timeline('payment.created', id, {
        customerId: input.customerId,
        paymentNumber,
        amount: input.amount,
      });
      timeline('payment.allocated', id, {
        allocations: input.allocations,
        allocationTotal,
      });

      const paymentRow = db
        .prepare('SELECT * FROM customer_payments WHERE id = ?')
        .get(id) as DbCustomerPaymentRow;
      return mapCustomerPaymentRow(paymentRow, getAllocationsForPayment(id));
    },

    getCustomerPaymentById(id) {
      const row = db.prepare('SELECT * FROM customer_payments WHERE id = ?').get(id) as
        | DbCustomerPaymentRow
        | undefined;
      if (!row) {
        return null;
      }
      return mapCustomerPaymentRow(row, getAllocationsForPayment(id));
    },

    listCustomerPayments(filter) {
      const rowFilter = filter ?? {};
      const rows = db
        .prepare(
          `SELECT cp.*
           FROM customer_payments cp
           WHERE (? IS NULL OR cp.customer_id = ?)
             AND (? IS NULL OR cp.payment_date >= ?)
             AND (? IS NULL OR cp.payment_date <= ?)
             AND (
               ? IS NULL OR EXISTS (
                 SELECT 1 FROM payment_allocations pa
                 WHERE pa.payment_id = cp.id AND pa.invoice_id = ?
               )
             )
           ORDER BY cp.payment_date DESC, cp.created_at DESC`,
        )
        .all(
          rowFilter.customerId ?? null,
          rowFilter.customerId ?? null,
          rowFilter.from ?? null,
          rowFilter.from ?? null,
          rowFilter.to ?? null,
          rowFilter.to ?? null,
          rowFilter.invoiceId ?? null,
          rowFilter.invoiceId ?? null,
        ) as DbCustomerPaymentRow[];
      return rows.map((row) => mapCustomerPaymentRow(row, getAllocationsForPayment(row.id)));
    },

    createSupplierBillDraft(input) {
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const { totals, calculatedItems } = calculateTotals(input.lineItems);
      const id = randomUUID();
      const now = nowIso();
      try {
        db.prepare(
          `INSERT INTO supplier_bills (
            id,
            supplier_id,
            source_purchase_order_id,
            bill_number,
            bill_date,
            due_date,
            supplier_reference,
            currency,
            notes,
            status,
            payment_state,
            subtotal,
            gst_total,
            total,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.supplierId,
          null,
          null,
          input.billDate,
          input.dueDate,
          input.supplierReference ?? null,
          input.currency,
          input.notes ?? null,
          'Draft',
          'Draft',
          totals.subtotal,
          totals.gstTotal,
          totals.total,
          now,
          now,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('uq_supplier_bills_supplier_reference_not_null') ||
          message.includes('UNIQUE constraint failed: supplier_bills.supplier_id, supplier_bills.supplier_reference')
        ) {
          throw new Error('SUPPLIER_BILL_REFERENCE_EXISTS');
        }
        throw error;
      }

      const insertLine = db.prepare(
        `INSERT INTO supplier_bill_line_items (
          id, supplier_bill_id, source_purchase_order_line_item_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [index, item] of calculatedItems.entries()) {
        const inputLine = input.lineItems[index];
        if (!inputLine) {
          throw new Error('SUPPLIER_BILL_LINE_ITEM_MISMATCH');
        }
        const sourcePurchaseOrderLineItemId = inputLine.sourcePurchaseOrderLineItemId;
        insertLine.run(
          randomUUID(),
          id,
          sourcePurchaseOrderLineItemId ?? null,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      upsertDocument(
        id,
        `Draft Supplier Bill ${input.supplierReference ?? ''}`.trim(),
        'supplier_bill',
        `${input.currency} ${input.notes ?? ''} ${input.supplierReference ?? ''}`,
      );
      timeline('supplier_bill.created', id, {
        status: 'Draft',
        supplierId: input.supplierId,
        total: totals.total,
      });

      const row = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(id) as DbSupplierBillRow;
      return mapSupplierBillRow(row);
    },

    createSupplierBillDraftFromPurchaseOrder(purchaseOrderId, input) {
      const purchaseOrder = this.getPurchaseOrderById(purchaseOrderId);
      if (!purchaseOrder) {
        throw new Error('PURCHASE_ORDER_NOT_FOUND');
      }
      if (purchaseOrder.status !== 'Approved') {
        throw new Error('PURCHASE_ORDER_REQUIRES_APPROVED_STATUS');
      }
      if (purchaseOrder.billingStatus === 'fully_billed') {
        throw new Error('PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED');
      }

      const sourceLines =
        input?.lineItems && input.lineItems.length > 0
          ? input.lineItems
          : purchaseOrder.lineItems.map((lineItem) => ({
              purchaseOrderLineItemId: lineItem.id!,
              quantity: lineItem.quantity,
            }));

      const duplicateSourceLines = new Set(sourceLines.map((lineItem) => lineItem.purchaseOrderLineItemId));
      if (duplicateSourceLines.size !== sourceLines.length) {
        throw new Error('PURCHASE_ORDER_BILLING_DUPLICATE_LINE_ITEM');
      }

      const purchaseOrderLineMap = new Map(
        purchaseOrder.lineItems.map((lineItem) => [lineItem.id!, lineItem]),
      );
      const selectedSupplierBillLineItems: Array<
        SupplierBillLineItemInput & { sourcePurchaseOrderLineItemId: string }
      > = [];
      let selectedTotal = 0;

      for (const sourceLine of sourceLines) {
        if (sourceLine.quantity <= 0) {
          throw new Error('PURCHASE_ORDER_BILLING_QUANTITY_INVALID');
        }
        const purchaseOrderLine = purchaseOrderLineMap.get(sourceLine.purchaseOrderLineItemId);
        if (!purchaseOrderLine) {
          throw new Error('PURCHASE_ORDER_LINE_ITEM_NOT_FOUND');
        }

        const billedQtyRow = db
          .prepare(
            `SELECT coalesce(sum(li.quantity), 0) AS total
             FROM supplier_bill_line_items li
             INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
             WHERE b.source_purchase_order_id = ?
               AND li.source_purchase_order_line_item_id = ?`,
          )
          .get(purchaseOrderId, sourceLine.purchaseOrderLineItemId) as { total: number };
        const remainingQty = purchaseOrderLine.quantity - billedQtyRow.total;
        if (sourceLine.quantity > remainingQty + 1e-9) {
          throw new Error('PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING');
        }

        selectedSupplierBillLineItems.push({
          description: purchaseOrderLine.description,
          quantity: sourceLine.quantity,
          unitPrice: purchaseOrderLine.unitPrice,
          gstApplicable: purchaseOrderLine.gstApplicable,
          sourcePurchaseOrderLineItemId: sourceLine.purchaseOrderLineItemId,
        });
        selectedTotal +=
          sourceLine.quantity * purchaseOrderLine.unitPrice * (purchaseOrderLine.gstApplicable ? 1.1 : 1);
      }

      if (selectedSupplierBillLineItems.length === 0) {
        throw new Error('PURCHASE_ORDER_BILLING_LINES_REQUIRED');
      }
      if (selectedTotal > purchaseOrder.remainingUnbilledAmount + 1e-6) {
        throw new Error('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING');
      }

      const existingLinkedBillCount = db
        .prepare('SELECT count(*) AS count FROM supplier_bills WHERE source_purchase_order_id = ?')
        .get(purchaseOrderId) as { count: number };

      const created = this.createSupplierBillDraft({
        supplierId: purchaseOrder.supplierId,
        billDate: purchaseOrder.issueDate,
        dueDate: purchaseOrder.expectedDeliveryDate ?? purchaseOrder.issueDate,
        supplierReference: `PO-${purchaseOrder.purchaseOrderNumber}-${existingLinkedBillCount.count + 1}`,
        currency: purchaseOrder.currency,
        notes: purchaseOrder.notes ?? undefined,
        lineItems: selectedSupplierBillLineItems,
      });

      try {
        db.prepare('UPDATE supplier_bills SET source_purchase_order_id = ?, updated_at = ? WHERE id = ?').run(
          purchaseOrderId,
          nowIso(),
          created.id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('uq_supplier_bills_source_purchase_order_not_null') ||
          message.includes('UNIQUE constraint failed: supplier_bills.source_purchase_order_id')
        ) {
          throw new Error('PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED');
        }
        throw error;
      }

      const billingSummaryAfter = getPurchaseOrderBillingSummary(purchaseOrder.id, purchaseOrder.totals.total);
      timeline('supplier_bill.created_from_purchase_order', created.id, {
        purchaseOrderId,
        supplierBillId: created.id,
      });
      if (billingSummaryAfter.billingStatus === 'fully_billed') {
        timeline('purchase_order.fully_billed', purchaseOrder.id, {
          totalBilledAmount: billingSummaryAfter.totalBilledAmount,
        });
      } else if (billingSummaryAfter.billingStatus === 'partially_billed') {
        timeline('purchase_order.partially_billed', purchaseOrder.id, {
          totalBilledAmount: billingSummaryAfter.totalBilledAmount,
          remainingUnbilledAmount: billingSummaryAfter.remainingUnbilledAmount,
        });
      }

      const linkedRow = db
        .prepare(
          `SELECT sb.*, po.purchase_order_number AS source_purchase_order_number
           FROM supplier_bills sb
           LEFT JOIN purchase_orders po ON po.id = sb.source_purchase_order_id
           WHERE sb.id = ?`,
        )
        .get(created.id) as DbSupplierBillRow;
      return mapSupplierBillRow(linkedRow);
    },

    updateSupplierBillDraft(id, input) {
      const existing = db
        .prepare('SELECT status, supplier_id, source_purchase_order_id FROM supplier_bills WHERE id = ?')
        .get(id) as
        | {
            status: SupplierBillStatus;
            supplier_id: string;
            source_purchase_order_id: string | null;
          }
        | undefined;
      if (!existing) {
        throw new Error('Supplier bill not found');
      }
      if (existing.status !== 'Draft') {
        throw new Error('Only draft supplier bills can be edited');
      }

      const isPoLinked = Boolean(existing.source_purchase_order_id);
      if (isPoLinked) {
        const sourcePurchaseOrderId = existing.source_purchase_order_id;
        if (!sourcePurchaseOrderId) {
          throw new Error('SUPPLIER_BILL_SOURCE_PO_NOT_FOUND');
        }
        const linkedPurchaseOrder = this.getPurchaseOrderById(sourcePurchaseOrderId);
        if (!linkedPurchaseOrder) {
          throw new Error('SUPPLIER_BILL_SOURCE_PO_NOT_FOUND');
        }
        if (linkedPurchaseOrder.supplierId !== existing.supplier_id) {
          throw new Error('SUPPLIER_BILL_SOURCE_PO_SUPPLIER_MISMATCH');
        }
        if (input.currency !== linkedPurchaseOrder.currency) {
          throw new Error('SUPPLIER_BILL_LINKED_CURRENCY_IMMUTABLE');
        }

        const existingLinkedLineRows = db
          .prepare(
            `SELECT source_purchase_order_line_item_id
             FROM supplier_bill_line_items
             WHERE supplier_bill_id = ?`,
          )
          .all(id) as Array<{ source_purchase_order_line_item_id: string | null }>;
        const existingLinkedSourceIds = existingLinkedLineRows
          .map((row) => row.source_purchase_order_line_item_id)
          .filter((value): value is string => value !== null)
          .sort();
        const updatedLinkedSourceIds = input.lineItems
          .map((lineItem) => lineItem.sourcePurchaseOrderLineItemId)
          .filter((value): value is string => typeof value === 'string')
          .sort();
        if (
          existingLinkedSourceIds.length !== updatedLinkedSourceIds.length ||
          existingLinkedSourceIds.some((value, index) => value !== updatedLinkedSourceIds[index])
        ) {
          throw new Error('SUPPLIER_BILL_SOURCE_PO_LINE_REFERENCE_IMMUTABLE');
        }

        const purchaseOrderLineMap = new Map(
          linkedPurchaseOrder.lineItems.map((lineItem) => [lineItem.id!, lineItem]),
        );
        let projectedLinkedTotal = 0;
        for (const lineItem of input.lineItems) {
          if (!lineItem.sourcePurchaseOrderLineItemId) {
            throw new Error('SUPPLIER_BILL_LINKED_LINE_SOURCE_REQUIRED');
          }
          const sourceLine = purchaseOrderLineMap.get(lineItem.sourcePurchaseOrderLineItemId);
          if (!sourceLine) {
            throw new Error('SUPPLIER_BILL_SOURCE_PO_LINE_MISMATCH');
          }

          const otherBillsSummary = db
            .prepare(
              `SELECT
                 coalesce(sum(li.quantity), 0) AS total_quantity,
                 coalesce(sum(li.line_total), 0) AS total_amount
               FROM supplier_bill_line_items li
               INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
               WHERE b.source_purchase_order_id = ?
                 AND b.id != ?
                 AND li.source_purchase_order_line_item_id = ?`,
            )
            .get(sourcePurchaseOrderId, id, lineItem.sourcePurchaseOrderLineItemId) as {
            total_quantity: number;
            total_amount: number;
          };

          const remainingLineQuantity = sourceLine.quantity - otherBillsSummary.total_quantity;
          if (lineItem.quantity > remainingLineQuantity + 1e-9) {
            throw new Error('PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING');
          }

          const sourceLineUnitTotal = sourceLine.unitPrice * (sourceLine.gstApplicable ? 1.1 : 1);
          const remainingLineAmount = sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
          const updatedLineAmount = lineItem.quantity * lineItem.unitPrice * (lineItem.gstApplicable ? 1.1 : 1);
          if (updatedLineAmount > remainingLineAmount + 1e-6) {
            throw new Error('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING');
          }
          projectedLinkedTotal += updatedLineAmount;
        }

        const linkedPoSummaryExcludingBill = db
          .prepare(
            `SELECT coalesce(sum(li.line_total), 0) AS total
             FROM supplier_bill_line_items li
             INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
             WHERE b.source_purchase_order_id = ?
               AND b.id != ?`,
          )
          .get(sourcePurchaseOrderId, id) as { total: number };
        if (linkedPoSummaryExcludingBill.total + projectedLinkedTotal > linkedPurchaseOrder.totals.total + 1e-6) {
          throw new Error('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING');
        }
      }

      const { totals, calculatedItems } = calculateTotals(input.lineItems);
      try {
        db.prepare(
          `UPDATE supplier_bills
           SET bill_date = ?, due_date = ?, supplier_reference = ?, currency = ?, notes = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          input.billDate,
          input.dueDate,
          input.supplierReference ?? null,
          input.currency,
          input.notes ?? null,
          totals.subtotal,
          totals.gstTotal,
          totals.total,
          nowIso(),
          id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('uq_supplier_bills_supplier_reference_not_null') ||
          message.includes('UNIQUE constraint failed: supplier_bills.supplier_id, supplier_bills.supplier_reference')
        ) {
          throw new Error('SUPPLIER_BILL_REFERENCE_EXISTS');
        }
        throw error;
      }

      db.prepare('DELETE FROM supplier_bill_line_items WHERE supplier_bill_id = ?').run(id);
      const insertLine = db.prepare(
        `INSERT INTO supplier_bill_line_items (
          id, supplier_bill_id, source_purchase_order_line_item_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [index, item] of calculatedItems.entries()) {
        const inputLine = input.lineItems[index];
        if (!inputLine) {
          throw new Error('SUPPLIER_BILL_LINE_ITEM_MISMATCH');
        }
        const sourcePurchaseOrderLineItemId = inputLine.sourcePurchaseOrderLineItemId;
        insertLine.run(
          randomUUID(),
          id,
          sourcePurchaseOrderLineItemId ?? null,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      const row = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(id) as DbSupplierBillRow;
      upsertDocument(
        id,
        `${row.bill_number ?? 'Draft'} ${row.supplier_reference ?? ''}`.trim(),
        'supplier_bill',
        `${row.currency} ${row.notes ?? ''} ${row.supplier_reference ?? ''}`,
      );
      return mapSupplierBillRow(row);
    },

    getSupplierBillById(id) {
      const row = db
        .prepare(
          `SELECT sb.*, po.purchase_order_number AS source_purchase_order_number
           FROM supplier_bills sb
           LEFT JOIN purchase_orders po ON po.id = sb.source_purchase_order_id
           WHERE sb.id = ?`,
        )
        .get(id) as
        | DbSupplierBillRow
        | undefined;
      if (!row) {
        return null;
      }
      const lineItemsRows = db
        .prepare(
          `SELECT id, source_purchase_order_line_item_id, description, quantity, unit_price, gst_applicable
           FROM supplier_bill_line_items
           WHERE supplier_bill_id = ?`,
        )
        .all(id) as DbSupplierBillLineItemRow[];
      const lineItems: SupplierBillLineItemInput[] = lineItemsRows.map((item) => ({
        id: item.id,
        sourcePurchaseOrderLineItemId: item.source_purchase_order_line_item_id ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        gstApplicable: item.gst_applicable === 1,
      }));

      return {
        ...mapSupplierBillRow(row),
        lineItems,
      };
    },

    finaliseSupplierBill(id) {
      const bill = this.getSupplierBillById(id);
      if (!bill) {
        throw new Error('Supplier bill not found');
      }
      if (bill.status !== 'Draft') {
        throw new Error('Supplier bill already finalised');
      }
      if (!bill.lineItems || bill.lineItems.length === 0) {
        throw new Error('SUPPLIER_BILL_FINALISE_EMPTY_LINE_ITEMS');
      }

      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(bill.supplierId);
      if (!supplier) {
        throw new Error('SUPPLIER_BILL_FINALISE_SUPPLIER_NOT_FOUND');
      }

      for (const lineItem of bill.lineItems) {
        if (lineItem.quantity <= 0) {
          throw new Error('SUPPLIER_BILL_FINALISE_INVALID_LINE_QUANTITY');
        }
        if (lineItem.unitPrice < 0) {
          throw new Error('SUPPLIER_BILL_FINALISE_INVALID_LINE_UNIT_PRICE');
        }
      }

      const reconciledTotals = calculateTotals(bill.lineItems).totals;
      if (
        Math.abs(reconciledTotals.subtotal - bill.totals.subtotal) > 1e-6 ||
        Math.abs(reconciledTotals.gstTotal - bill.totals.gstTotal) > 1e-6 ||
        Math.abs(reconciledTotals.total - bill.totals.total) > 1e-6
      ) {
        throw new Error('SUPPLIER_BILL_FINALISE_TOTALS_MISMATCH');
      }

      if (bill.sourcePurchaseOrderId) {
        const sourcePurchaseOrder = this.getPurchaseOrderById(bill.sourcePurchaseOrderId);
        if (!sourcePurchaseOrder) {
          throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_NOT_FOUND');
        }
        if (sourcePurchaseOrder.supplierId !== bill.supplierId) {
          throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_SUPPLIER_MISMATCH');
        }

        const sourcePurchaseOrderLineMap = new Map(
          sourcePurchaseOrder.lineItems.map((lineItem) => [lineItem.id!, lineItem]),
        );
        let projectedSupplierBillTotal = 0;
        for (const lineItem of bill.lineItems) {
          if (!lineItem.sourcePurchaseOrderLineItemId) {
            throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_LINE_REFERENCE_REQUIRED');
          }
          const sourceLine = sourcePurchaseOrderLineMap.get(lineItem.sourcePurchaseOrderLineItemId);
          if (!sourceLine) {
            throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_LINE_REFERENCE_INVALID');
          }

          const otherBillsSummary = db
            .prepare(
              `SELECT
                 coalesce(sum(li.quantity), 0) AS total_quantity,
                 coalesce(sum(li.line_total), 0) AS total_amount
               FROM supplier_bill_line_items li
               INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
               WHERE b.source_purchase_order_id = ?
                 AND b.id != ?
                 AND li.source_purchase_order_line_item_id = ?`,
            )
            .get(bill.sourcePurchaseOrderId, id, lineItem.sourcePurchaseOrderLineItemId) as {
            total_quantity: number;
            total_amount: number;
          };

          const remainingLineQuantity = sourceLine.quantity - otherBillsSummary.total_quantity;
          if (lineItem.quantity > remainingLineQuantity + 1e-9) {
            throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING');
          }

          const sourceLineUnitTotal = sourceLine.unitPrice * (sourceLine.gstApplicable ? 1.1 : 1);
          const remainingLineAmount = sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
          const lineAmount = lineItem.quantity * lineItem.unitPrice * (lineItem.gstApplicable ? 1.1 : 1);
          if (lineAmount > remainingLineAmount + 1e-6) {
            throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_VALUE_EXCEEDS_REMAINING');
          }
          projectedSupplierBillTotal += lineAmount;
        }

        const otherLinkedBillsTotal = db
          .prepare(
            `SELECT coalesce(sum(li.line_total), 0) AS total
             FROM supplier_bill_line_items li
             INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
             WHERE b.source_purchase_order_id = ?
               AND b.id != ?`,
          )
          .get(bill.sourcePurchaseOrderId, id) as { total: number };
        if (otherLinkedBillsTotal.total + projectedSupplierBillTotal > sourcePurchaseOrder.totals.total + 1e-6) {
          throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_VALUE_EXCEEDS_REMAINING');
        }
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM supplier_bill_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;

      let prefix = 'BILL';
      let sequence = 1;
      if (!sequenceRow) {
        db.prepare('INSERT INTO supplier_bill_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE supplier_bill_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE supplier_bill_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const billNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();
      upsertDocument(
        id,
        `${billNumber} ${bill.supplierReference ?? ''}`.trim(),
        'supplier_bill',
        `${billNumber} ${bill.currency} ${bill.notes ?? ''}`,
      );
      db.prepare(
        `UPDATE supplier_bills
         SET status = 'Finalised', bill_number = ?, payment_state = 'Awaiting Payment', updated_at = ?
         WHERE id = ?`,
      ).run(billNumber, now, id);

      const finalised = this.getSupplierBillById(id);
      if (!finalised) {
        throw new Error('Failed to load finalised supplier bill');
      }
      timeline('supplier_bill.finalised', id, {
        billNumber,
        total: finalised.totals.total,
        linkageType: finalised.sourcePurchaseOrderId ? 'purchase_order_linked' : 'standalone',
        sourcePurchaseOrderId: finalised.sourcePurchaseOrderId,
        sourcePurchaseOrderNumber: finalised.sourcePurchaseOrderNumber,
      });

      return mapSupplierBillRow(db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(id) as DbSupplierBillRow);
    },

    listSupplierBills(filter) {
      const rowFilter = filter ?? {};
      const rows = db
        .prepare(
          `SELECT sb.*, po.purchase_order_number AS source_purchase_order_number
           FROM supplier_bills sb
           LEFT JOIN purchase_orders po ON po.id = sb.source_purchase_order_id
           WHERE (? IS NULL OR sb.supplier_id = ?)
             AND (? IS NULL OR sb.source_purchase_order_id = ?)
             AND (? IS NULL OR sb.bill_number = ?)
             AND (? IS NULL OR sb.bill_date >= ?)
             AND (? IS NULL OR sb.bill_date <= ?)
             AND (? IS NULL OR sb.due_date >= ?)
             AND (? IS NULL OR sb.due_date <= ?)
             AND (? IS NULL OR sb.status = ?)
           AND (? IS NULL OR sb.payment_state = ?)
           ORDER BY sb.bill_date DESC, sb.created_at DESC`,
        )
        .all(
          rowFilter.supplierId ?? null,
          rowFilter.supplierId ?? null,
          rowFilter.sourcePurchaseOrderId ?? null,
          rowFilter.sourcePurchaseOrderId ?? null,
          rowFilter.billNumber ?? null,
          rowFilter.billNumber ?? null,
          rowFilter.fromBillDate ?? null,
          rowFilter.fromBillDate ?? null,
          rowFilter.toBillDate ?? null,
          rowFilter.toBillDate ?? null,
          rowFilter.fromDueDate ?? null,
          rowFilter.fromDueDate ?? null,
          rowFilter.toDueDate ?? null,
          rowFilter.toDueDate ?? null,
          rowFilter.status ?? null,
          rowFilter.status ?? null,
          rowFilter.paymentState ?? null,
          rowFilter.paymentState ?? null,
        ) as DbSupplierBillRow[];
      return rows.map(mapSupplierBillRow);
    },

    createPurchaseOrderDraft(input) {
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM purchase_order_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;
      let prefix = 'PO';
      let sequence = 1;
      if (!sequenceRow) {
        db.prepare('INSERT INTO purchase_order_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE purchase_order_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE purchase_order_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const { totals, calculatedItems } = calculateTotals(input.lineItems);
      const id = randomUUID();
      const now = nowIso();
      const purchaseOrderNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      try {
        db.prepare(
          `INSERT INTO purchase_orders (
            id,
            purchase_order_number,
            supplier_id,
            issue_date,
            expected_delivery_date,
            supplier_reference,
            currency,
            notes,
            status,
            close_reason,
            closed_date,
            closed_by,
            subtotal,
            gst_total,
            total,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          purchaseOrderNumber,
          input.supplierId,
          input.issueDate,
          input.expectedDeliveryDate ?? null,
          input.supplierReference ?? null,
          input.currency,
          input.notes ?? null,
          'Draft',
          null,
          null,
          null,
          totals.subtotal,
          totals.gstTotal,
          totals.total,
          now,
          now,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('uq_purchase_orders_supplier_reference_not_null') ||
          message.includes('UNIQUE constraint failed: purchase_orders.supplier_id, purchase_orders.supplier_reference')
        ) {
          throw new Error('PURCHASE_ORDER_REFERENCE_EXISTS');
        }
        throw error;
      }

      const insertLine = db.prepare(
        `INSERT INTO purchase_order_line_items (
          id, purchase_order_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of calculatedItems) {
        insertLine.run(
          randomUUID(),
          id,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      upsertDocument(
        id,
        `${purchaseOrderNumber} ${input.supplierReference ?? ''}`.trim(),
        'purchase_order',
        `${purchaseOrderNumber} ${input.currency} ${input.notes ?? ''} ${input.supplierReference ?? ''}`,
      );
      timeline('purchase_order.created', id, {
        purchaseOrderNumber,
        supplierId: input.supplierId,
        total: totals.total,
      });

      const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as DbPurchaseOrderRow;
      return withPurchaseOrderBillingSummary(mapPurchaseOrderRow(row));
    },

    updatePurchaseOrderDraft(id, input) {
      const existing = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id) as
        | { status: PurchaseOrderStatus }
        | undefined;
      if (!existing) {
        throw new Error('Purchase order not found');
      }
      if (existing.status !== 'Draft') {
        throw new Error('Only draft purchase orders can be edited');
      }

      const { totals, calculatedItems } = calculateTotals(input.lineItems);
      try {
        db.prepare(
          `UPDATE purchase_orders
           SET issue_date = ?, expected_delivery_date = ?, supplier_reference = ?, currency = ?, notes = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          input.issueDate,
          input.expectedDeliveryDate ?? null,
          input.supplierReference ?? null,
          input.currency,
          input.notes ?? null,
          totals.subtotal,
          totals.gstTotal,
          totals.total,
          nowIso(),
          id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('uq_purchase_orders_supplier_reference_not_null') ||
          message.includes('UNIQUE constraint failed: purchase_orders.supplier_id, purchase_orders.supplier_reference')
        ) {
          throw new Error('PURCHASE_ORDER_REFERENCE_EXISTS');
        }
        throw error;
      }

      db.prepare('DELETE FROM purchase_order_line_items WHERE purchase_order_id = ?').run(id);
      const insertLine = db.prepare(
        `INSERT INTO purchase_order_line_items (
          id, purchase_order_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of calculatedItems) {
        insertLine.run(
          randomUUID(),
          id,
          item.description,
          item.quantity,
          item.unitPrice,
          item.gstApplicable ? 1 : 0,
          item.lineSubtotal,
          item.lineGst,
          item.lineTotal,
        );
      }

      const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as DbPurchaseOrderRow;
      upsertDocument(
        id,
        `${row.purchase_order_number} ${row.supplier_reference ?? ''}`.trim(),
        'purchase_order',
        `${row.purchase_order_number} ${row.currency} ${row.notes ?? ''} ${row.supplier_reference ?? ''}`,
      );
      return withPurchaseOrderBillingSummary(mapPurchaseOrderRow(row));
    },

    getPurchaseOrderById(id) {
      const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as
        | DbPurchaseOrderRow
        | undefined;
      if (!row) {
        return null;
      }
      const lineItemsRows = db
        .prepare(
          `SELECT id, description, quantity, unit_price, gst_applicable
           FROM purchase_order_line_items
           WHERE purchase_order_id = ?`,
        )
        .all(id) as DbPurchaseOrderLineItemRow[];
      const lineItems: PurchaseOrderLineItemInput[] = lineItemsRows.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        gstApplicable: item.gst_applicable === 1,
      }));
      const purchaseOrder = {
        ...mapPurchaseOrderRow(row),
        lineItems,
      };
      return withPurchaseOrderBillingSummary(purchaseOrder);
    },

    approvePurchaseOrder(id) {
      const order = this.getPurchaseOrderById(id);
      if (!order) {
        throw new Error('Purchase order not found');
      }
      assertValidPurchaseOrderStatusTransitionOrThrow(order.status, 'Approved');
      db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run('Approved', nowIso(), id);
      timeline('purchase_order.approved', id, {
        purchaseOrderNumber: order.purchaseOrderNumber,
      });
      return withPurchaseOrderBillingSummary(
        mapPurchaseOrderRow(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as DbPurchaseOrderRow),
      );
    },

    closePurchaseOrder(id, input) {
      const order = this.getPurchaseOrderById(id);
      if (!order) {
        throw new Error('Purchase order not found');
      }
      if (order.status === 'Draft') {
        throw new Error('PURCHASE_ORDER_DRAFT_CANNOT_CLOSE');
      }
      if (order.status === 'Cancelled') {
        throw new Error('PURCHASE_ORDER_CANCELLED_CANNOT_CLOSE');
      }
      if (order.status === 'Closed') {
        throw new Error('PURCHASE_ORDER_ALREADY_CLOSED');
      }
      assertValidPurchaseOrderStatusTransitionOrThrow(order.status, 'Closed');

      const closeReason = input?.closeReason?.trim();
      const closedDate = input?.closedDate;
      const closedBy = input?.closedBy?.trim() || 'system';

      if (order.billingStatus !== 'fully_billed') {
        if (!closeReason) {
          throw new Error('PURCHASE_ORDER_CLOSE_REASON_REQUIRED');
        }
        if (!closedDate) {
          throw new Error('PURCHASE_ORDER_CLOSE_DATE_REQUIRED');
        }
      }

      const persistedClosedDate = closedDate ?? nowIso().slice(0, 10);
      db.prepare(
        'UPDATE purchase_orders SET status = ?, close_reason = ?, closed_date = ?, closed_by = ?, updated_at = ? WHERE id = ?',
      ).run('Closed', closeReason ?? null, persistedClosedDate, closedBy, nowIso(), id);

      const closureType =
        order.billingStatus === 'fully_billed'
          ? 'fully_billed_closure'
          : order.billingStatus === 'partially_billed'
            ? 'partially_billed_closure'
            : 'unbilled_closure';
      timeline('purchase_order.closed', id, {
        purchaseOrderNumber: order.purchaseOrderNumber,
        closureType,
        billingStatus: order.billingStatus,
        totalBilledAmount: order.totalBilledAmount,
        remainingUnbilledAmount: order.remainingUnbilledAmount,
        closeReason: closeReason ?? null,
        closedDate: persistedClosedDate,
        closedBy,
      });
      return withPurchaseOrderBillingSummary(
        mapPurchaseOrderRow(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as DbPurchaseOrderRow),
      );
    },

    cancelPurchaseOrder(id) {
      const order = this.getPurchaseOrderById(id);
      if (!order) {
        throw new Error('Purchase order not found');
      }
      assertValidPurchaseOrderStatusTransitionOrThrow(order.status, 'Cancelled');
      db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run('Cancelled', nowIso(), id);
      timeline('purchase_order.cancelled', id, {
        purchaseOrderNumber: order.purchaseOrderNumber,
      });
      return withPurchaseOrderBillingSummary(
        mapPurchaseOrderRow(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as DbPurchaseOrderRow),
      );
    },

    listPurchaseOrders(filter) {
      const rowFilter = filter ?? {};
      const rows = db
        .prepare(
          `SELECT *
           FROM purchase_orders
           WHERE (? IS NULL OR supplier_id = ?)
             AND (? IS NULL OR purchase_order_number = ?)
             AND (? IS NULL OR status = ?)
             AND (? IS NULL OR issue_date >= ?)
             AND (? IS NULL OR issue_date <= ?)
             AND (? IS NULL OR expected_delivery_date >= ?)
             AND (? IS NULL OR expected_delivery_date <= ?)
           ORDER BY issue_date DESC, created_at DESC`,
        )
        .all(
          rowFilter.supplierId ?? null,
          rowFilter.supplierId ?? null,
          rowFilter.purchaseOrderNumber ?? null,
          rowFilter.purchaseOrderNumber ?? null,
          rowFilter.status ?? null,
          rowFilter.status ?? null,
          rowFilter.fromIssueDate ?? null,
          rowFilter.fromIssueDate ?? null,
          rowFilter.toIssueDate ?? null,
          rowFilter.toIssueDate ?? null,
          rowFilter.fromExpectedDeliveryDate ?? null,
          rowFilter.fromExpectedDeliveryDate ?? null,
          rowFilter.toExpectedDeliveryDate ?? null,
          rowFilter.toExpectedDeliveryDate ?? null,
        ) as DbPurchaseOrderRow[];
      const mapped = rows.map((row) => withPurchaseOrderBillingSummary(mapPurchaseOrderRow(row)));
      if (!rowFilter.billingStatus) {
        return mapped;
      }
      return mapped.filter((order) => order.billingStatus === rowFilter.billingStatus);
    },

    createSupplierPayment(input) {
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!supplier) {
        throw new Error('Supplier not found');
      }
      if (input.allocations.length === 0) {
        throw new Error('SUPPLIER_PAYMENT_ALLOCATIONS_REQUIRED');
      }

      const allocationBillSet = new Set(input.allocations.map((allocation) => allocation.supplierBillId));
      if (allocationBillSet.size !== input.allocations.length) {
        throw new Error('SUPPLIER_PAYMENT_DUPLICATE_ALLOCATION_BILL');
      }

      const allocationTotal = input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      if (allocationTotal > input.amount) {
        throw new Error('SUPPLIER_PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT');
      }

      for (const allocation of input.allocations) {
        if (allocation.amount <= 0) {
          throw new Error('SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID');
        }

        const bill = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(allocation.supplierBillId) as
          | DbSupplierBillRow
          | undefined;
        if (!bill) {
          throw new Error('Supplier bill not found');
        }
        if (bill.status !== 'Finalised') {
          throw new Error('SUPPLIER_PAYMENT_ALLOCATION_REQUIRES_FINALISED_BILL');
        }
        if (bill.supplier_id !== input.supplierId) {
          throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SUPPLIER_MISMATCH');
        }
        if (bill.payment_state === 'Cancelled') {
          throw new Error('SUPPLIER_PAYMENT_ALLOCATION_FOR_CANCELLED_BILL_FORBIDDEN');
        }

        if (bill.source_purchase_order_id) {
          const sourcePurchaseOrder = this.getPurchaseOrderById(bill.source_purchase_order_id);
          if (!sourcePurchaseOrder) {
            throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_NOT_FOUND');
          }
          if (sourcePurchaseOrder.supplierId !== bill.supplier_id) {
            throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_SUPPLIER_MISMATCH');
          }

          const sourcePurchaseOrderLineMap = new Map(
            sourcePurchaseOrder.lineItems.map((lineItem) => [lineItem.id!, lineItem]),
          );
          const billLineRows = db
            .prepare(
              `SELECT source_purchase_order_line_item_id, quantity, line_total
               FROM supplier_bill_line_items
               WHERE supplier_bill_id = ?`,
            )
            .all(allocation.supplierBillId) as Array<{
            source_purchase_order_line_item_id: string | null;
            quantity: number;
            line_total: number;
          }>;

          for (const billLine of billLineRows) {
            if (!billLine.source_purchase_order_line_item_id) {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_LINE_REFERENCE_REQUIRED');
            }
            const sourceLine = sourcePurchaseOrderLineMap.get(billLine.source_purchase_order_line_item_id);
            if (!sourceLine) {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_LINE_REFERENCE_INVALID');
            }

            const otherBillsSummary = db
              .prepare(
                `SELECT
                   coalesce(sum(li.quantity), 0) AS total_quantity,
                   coalesce(sum(li.line_total), 0) AS total_amount
                 FROM supplier_bill_line_items li
                 INNER JOIN supplier_bills b ON b.id = li.supplier_bill_id
                 WHERE b.source_purchase_order_id = ?
                   AND b.id != ?
                   AND li.source_purchase_order_line_item_id = ?`,
              )
              .get(bill.source_purchase_order_id, allocation.supplierBillId, billLine.source_purchase_order_line_item_id) as {
              total_quantity: number;
              total_amount: number;
            };

            const remainingLineQuantity = sourceLine.quantity - otherBillsSummary.total_quantity;
            if (billLine.quantity > remainingLineQuantity + 1e-9) {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING');
            }

            const sourceLineUnitTotal = sourceLine.unitPrice * (sourceLine.gstApplicable ? 1.1 : 1);
            const remainingLineAmount = sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
            if (billLine.line_total > remainingLineAmount + 1e-6) {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_VALUE_EXCEEDS_REMAINING');
            }
          }
        }

        const existingAllocated = db
          .prepare(
            `SELECT coalesce(sum(spa.amount), 0) AS total
             FROM supplier_payment_allocations spa
             WHERE spa.supplier_bill_id = ?`,
          )
          .get(allocation.supplierBillId) as { total: number };
        const outstanding = bill.total - existingAllocated.total;
        if (allocation.amount > outstanding) {
          throw new Error('SUPPLIER_PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING');
        }
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM supplier_payment_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;
      let prefix = 'SPAY';
      let sequence = 1;
      if (!sequenceRow) {
        db.prepare('INSERT INTO supplier_payment_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE supplier_payment_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE supplier_payment_sequences SET next_sequence = ? WHERE id = 1').run(
            sequence + 1,
          );
        }
      }

      const id = randomUUID();
      const paymentNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();

      db.prepare(
        `INSERT INTO supplier_payments (
          id,
          payment_number,
          supplier_id,
          payment_date,
          payment_method,
          reference,
          amount,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        paymentNumber,
        input.supplierId,
        input.paymentDate,
        input.paymentMethod,
        input.reference,
        input.amount,
        input.notes ?? null,
        now,
        now,
      );

      const insertAllocation = db.prepare(
        `INSERT INTO supplier_payment_allocations (id, supplier_payment_id, supplier_bill_id, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const allocation of input.allocations) {
        insertAllocation.run(randomUUID(), id, allocation.supplierBillId, allocation.amount, now);
      }

      for (const allocation of input.allocations) {
        const bill = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(allocation.supplierBillId) as DbSupplierBillRow;
        const totalAllocated = db
          .prepare(
            `SELECT coalesce(sum(spa.amount), 0) AS total
             FROM supplier_payment_allocations spa
             WHERE spa.supplier_bill_id = ?`,
          )
          .get(allocation.supplierBillId) as { total: number };
        const nextState: PaymentState = totalAllocated.total >= bill.total ? 'Paid' : 'Awaiting Payment';
        db.prepare('UPDATE supplier_bills SET payment_state = ?, updated_at = ? WHERE id = ?').run(
          nextState,
          nowIso(),
          allocation.supplierBillId,
        );
      }

      upsertDocument(
        id,
        `${paymentNumber} ${input.reference}`,
        'receipt',
        `${paymentNumber} ${input.paymentMethod} ${input.reference} ${input.notes ?? ''}`,
      );
      timeline('supplier_payment.created', id, {
        supplierId: input.supplierId,
        paymentNumber,
        amount: input.amount,
      });
      timeline('supplier_payment.allocated', id, {
        allocations: input.allocations,
        allocationTotal,
      });

      const paymentRow = db
        .prepare('SELECT * FROM supplier_payments WHERE id = ?')
        .get(id) as DbSupplierPaymentRow;
      return mapSupplierPaymentRow(paymentRow, getAllocationsForSupplierPayment(id));
    },

    getSupplierPaymentById(id) {
      const row = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as
        | DbSupplierPaymentRow
        | undefined;
      if (!row) {
        return null;
      }
      return mapSupplierPaymentRow(row, getAllocationsForSupplierPayment(id));
    },

    listSupplierPayments(filter) {
      const rowFilter = filter ?? {};
      const rows = db
        .prepare(
          `SELECT sp.*
           FROM supplier_payments sp
           WHERE (? IS NULL OR sp.supplier_id = ?)
             AND (? IS NULL OR sp.payment_date >= ?)
             AND (? IS NULL OR sp.payment_date <= ?)
             AND (
               ? IS NULL OR EXISTS (
                 SELECT 1 FROM supplier_payment_allocations spa
                 WHERE spa.supplier_payment_id = sp.id AND spa.supplier_bill_id = ?
               )
             )
           ORDER BY sp.payment_date DESC, sp.created_at DESC`,
        )
        .all(
          rowFilter.supplierId ?? null,
          rowFilter.supplierId ?? null,
          rowFilter.from ?? null,
          rowFilter.from ?? null,
          rowFilter.to ?? null,
          rowFilter.to ?? null,
          rowFilter.supplierBillId ?? null,
          rowFilter.supplierBillId ?? null,
        ) as DbSupplierPaymentRow[];
      return rows.map((row) => mapSupplierPaymentRow(row, getAllocationsForSupplierPayment(row.id)));
    },

    createRole(input) {
      const id = randomUUID();
      const now = nowIso();
      try {
        db.prepare(
          `INSERT INTO roles (id, name, can_be_assigned, can_manage_assignments, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.name.trim(),
          input.canBeAssigned ? 1 : 0,
          input.canManageAssignments ? 1 : 0,
          now,
          now,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('UNIQUE constraint failed: roles.name')) {
          throw new Error('ROLE_NAME_EXISTS');
        }
        throw error;
      }
      const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as DbRoleRow;
      return mapRoleRow(row);
    },

    getRoleById(id) {
      const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as DbRoleRow | undefined;
      return row ? mapRoleRow(row) : null;
    },

    listRoles() {
      const rows = db.prepare('SELECT * FROM roles ORDER BY name ASC').all() as DbRoleRow[];
      return rows.map(mapRoleRow);
    },

    createUser(input) {
      const roleIds = Array.from(new Set(input.roleIds ?? []));
      if (roleIds.length > 0) {
        const existingRoleRows = db
          .prepare(`SELECT id FROM roles WHERE id IN (${roleIds.map(() => '?').join(',')})`)
          .all(...roleIds) as Array<{ id: string }>;
        if (existingRoleRows.length !== roleIds.length) {
          throw new Error('ROLE_NOT_FOUND');
        }
      }

      const id = randomUUID();
      const now = nowIso();
      db.prepare(
        `INSERT INTO users (id, display_name, email, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, input.displayName, input.email ?? null, input.isActive === false ? 0 : 1, now, now);

      const insertUserRole = db.prepare(
        `INSERT INTO user_role_links (id, user_id, role_id, created_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const roleId of roleIds) {
        insertUserRole.run(randomUUID(), id, roleId, now);
      }

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow;
      return mapUserRow(row, getRoleIdsForUser(id));
    },

    getUserById(id) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow | undefined;
      return row ? mapUserRow(row, getRoleIdsForUser(id)) : null;
    },

    listUsers() {
      const rows = db
        .prepare('SELECT * FROM users ORDER BY created_at DESC')
        .all() as DbUserRow[];
      return rows.map((row) => mapUserRow(row, getRoleIdsForUser(row.id)));
    },

    createTeam(input) {
      const id = randomUUID();
      const now = nowIso();
      db.prepare(
        `INSERT INTO teams (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run(id, input.name.trim(), now, now);
      const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as DbTeamRow;
      timeline('team.created', id, {
        name: row.name,
      });
      return mapTeamRow(row);
    },

    getTeamById(id) {
      const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as DbTeamRow | undefined;
      return row ? mapTeamRow(row) : null;
    },

    listTeams() {
      const rows = db.prepare('SELECT * FROM teams ORDER BY name ASC').all() as DbTeamRow[];
      return rows.map(mapTeamRow);
    },

    deleteTeam(teamId, actorUserId = null) {
      ensureTeamExistsOrThrow(teamId);

      const memberCount = getTeamMembershipCount(teamId);
      if (memberCount > 0) {
        assertAuthorizedForTeamActionOrThrow(teamId, actorUserId, 'delete_team');
      }

      const teamJobCount = db
        .prepare(
          `SELECT COUNT(1) AS total
           FROM jobs
           WHERE team_id = ?`,
        )
        .get(teamId) as { total: number };
      if (teamJobCount.total > 0) {
        throw new Error('TEAM_HAS_JOBS');
      }

      db.prepare('DELETE FROM team_memberships WHERE team_id = ?').run(teamId);
      db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
      timeline('team.deleted', teamId, {});
    },

    addTeamMember(teamId, userId, role = 'member', actorUserId = null) {
      ensureTeamExistsOrThrow(teamId);
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }
      const membershipCount = getTeamMembershipCount(teamId);
      const requestedRole = role ?? (membershipCount === 0 ? 'owner' : 'member');
      assertValidTeamMembershipRoleOrThrow(requestedRole);
      if (membershipCount === 0 && requestedRole !== 'owner') {
        throw new Error('TEAM_LAST_OWNER_REQUIRED');
      }
      if (membershipCount > 0) {
        assertAuthorizedForTeamActionOrThrow(teamId, actorUserId, 'add_member', null, requestedRole);
      }

      const id = randomUUID();
      const now = nowIso();
      try {
        db.prepare(
          `INSERT INTO team_memberships (id, team_id, user_id, role, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(id, teamId, userId, requestedRole, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('UNIQUE constraint failed: team_memberships.team_id, team_memberships.user_id')) {
          throw new Error('TEAM_MEMBER_EXISTS');
        }
        throw error;
      }

      timeline('team.member_added', teamId, {
        userId,
        role: requestedRole,
      });

      return {
        id,
        teamId,
        userId,
        role: requestedRole,
        createdAt: now,
        user,
      };
    },

    removeTeamMember(teamId, userId, actorUserId = null) {
      ensureTeamExistsOrThrow(teamId);
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const membership = db
        .prepare(
          `SELECT id, role
           FROM team_memberships
           WHERE team_id = ? AND user_id = ?`,
        )
        .get(teamId, userId) as { id: string; role: string } | undefined;
      if (!membership) {
        throw new Error('TEAM_MEMBER_NOT_FOUND');
      }
      assertValidTeamMembershipRoleOrThrow(membership.role);
      const targetRole = membership.role;
      assertAuthorizedForTeamActionOrThrow(teamId, actorUserId, 'remove_member', targetRole, null);
      if (targetRole === 'owner' && getOwnerCountForTeam(teamId) <= 1) {
        throw new Error('TEAM_LAST_OWNER_REQUIRED');
      }

      const scopedAssignmentsCount = db
        .prepare(
          `SELECT COUNT(1) AS total
           FROM jobs
           WHERE team_id = ? AND assigned_user_id = ?`,
        )
        .get(teamId, userId) as { total: number };
      if (scopedAssignmentsCount.total > 0) {
        throw new Error('TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS');
      }

      db.prepare('DELETE FROM team_memberships WHERE id = ?').run(membership.id);
      timeline('team.member_removed', teamId, {
        userId,
        role: targetRole,
      });
    },

    updateTeamMemberRole(teamId, userId, role, actorUserId = null) {
      ensureTeamExistsOrThrow(teamId);
      assertValidTeamMembershipRoleOrThrow(role);
      const membership = db
        .prepare(
          `SELECT id, role
           FROM team_memberships
           WHERE team_id = ? AND user_id = ?`,
        )
        .get(teamId, userId) as { id: string; role: string } | undefined;
      if (!membership) {
        throw new Error('TEAM_MEMBER_NOT_FOUND');
      }
      assertValidTeamMembershipRoleOrThrow(membership.role);
      const currentRole = membership.role;
      assertAuthorizedForTeamActionOrThrow(teamId, actorUserId, 'change_member_role', currentRole, role);

      if (currentRole === 'owner' && role !== 'owner' && getOwnerCountForTeam(teamId) <= 1) {
        throw new Error('TEAM_LAST_OWNER_REQUIRED');
      }

      db.prepare('UPDATE team_memberships SET role = ? WHERE id = ?').run(role, membership.id);

      const teamMembership = db
        .prepare(
          `SELECT
             tm.id AS id,
             tm.team_id AS team_id,
             tm.user_id AS user_id,
             tm.role AS role,
             tm.created_at AS created_at,
             u.id AS user_id_ref,
             u.display_name AS user_display_name,
             u.email AS user_email,
             u.is_active AS user_is_active,
             u.created_at AS user_created_at,
             u.updated_at AS user_updated_at
           FROM team_memberships tm
           INNER JOIN users u ON u.id = tm.user_id
           WHERE tm.id = ?`,
        )
        .get(membership.id) as {
        id: string;
        team_id: string;
        user_id: string;
        role: TeamMembershipRole;
        created_at: string;
        user_id_ref: string;
        user_display_name: string;
        user_email: string | null;
        user_is_active: number;
        user_created_at: string;
        user_updated_at: string;
      };

      return {
        id: teamMembership.id,
        teamId: teamMembership.team_id,
        userId: teamMembership.user_id,
        role: teamMembership.role,
        createdAt: teamMembership.created_at,
        user: mapUserRow(
          {
            id: teamMembership.user_id_ref,
            display_name: teamMembership.user_display_name,
            email: teamMembership.user_email,
            is_active: teamMembership.user_is_active,
            created_at: teamMembership.user_created_at,
            updated_at: teamMembership.user_updated_at,
          },
          getRoleIdsForUser(teamMembership.user_id_ref),
        ),
      };
    },

    listTeamMembers(teamId) {
      ensureTeamExistsOrThrow(teamId);
      const rows = db
        .prepare(
          `SELECT
             tm.id AS id,
             tm.team_id AS team_id,
             tm.user_id AS user_id,
             tm.role AS role,
             tm.created_at AS created_at,
             u.id AS user_id_ref,
             u.display_name AS user_display_name,
             u.email AS user_email,
             u.is_active AS user_is_active,
             u.created_at AS user_created_at,
             u.updated_at AS user_updated_at
           FROM team_memberships tm
           INNER JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = ?
           ORDER BY tm.created_at ASC`,
        )
        .all(teamId) as Array<{
        id: string;
        team_id: string;
        user_id: string;
        role: TeamMembershipRole;
        created_at: string;
        user_id_ref: string;
        user_display_name: string;
        user_email: string | null;
        user_is_active: number;
        user_created_at: string;
        user_updated_at: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        userId: row.user_id,
        role: row.role,
        createdAt: row.created_at,
        user: mapUserRow(
          {
            id: row.user_id_ref,
            display_name: row.user_display_name,
            email: row.user_email,
            is_active: row.user_is_active,
            created_at: row.user_created_at,
            updated_at: row.user_updated_at,
          },
          getRoleIdsForUser(row.user_id_ref),
        ),
      }));
    },

    createJob(input) {
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const currentYear = new Date().getUTCFullYear();
      const sequenceRow = db.prepare('SELECT * FROM job_sequences WHERE id = 1').get() as
        | { prefix: string; year: number; next_sequence: number }
        | undefined;
      let prefix = 'JOB';
      let sequence = 1;

      if (!sequenceRow) {
        db.prepare('INSERT INTO job_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)').run(
          prefix,
          currentYear,
          2,
        );
      } else {
        prefix = sequenceRow.prefix;
        if (sequenceRow.year !== currentYear) {
          sequence = 1;
          db.prepare('UPDATE job_sequences SET year = ?, next_sequence = ? WHERE id = 1').run(
            currentYear,
            2,
          );
        } else {
          sequence = sequenceRow.next_sequence;
          db.prepare('UPDATE job_sequences SET next_sequence = ? WHERE id = 1').run(sequence + 1);
        }
      }

      const id = randomUUID();
      const jobNumber = formatInvoiceNumber(prefix, currentYear, sequence);
      const now = nowIso();
      const nextTeamId = input.teamId ?? null;
      if (nextTeamId) {
        ensureTeamExistsOrThrow(nextTeamId);
      }
      if (!input.assignedUserId && input.assignedUserName) {
        throw new Error('ASSIGNED_USER_REQUIRES_ID');
      }
      const assignment = input.assignedUserId
        ? loadAssignableUserOrThrow(input.assignedUserId, input.assignedUserName ?? null)
        : null;
      assertAssignmentInTeamScopeOrThrow(
        nextTeamId,
        assignment?.userId ?? null,
        nextTeamId && assignment ? isUserInTeam(nextTeamId, assignment.userId) : true,
      );
      const completedDate =
        input.status === 'Completed' ? (input.completedDate ?? now) : (input.completedDate ?? null);

      db.prepare(
        `INSERT INTO jobs (
          id, job_number, title, description, customer_id, status, priority,
          scheduled_start_at, scheduled_end_at, assigned_user_id, assigned_user_name,
          team_id, completed_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        jobNumber,
        input.title,
        input.description ?? null,
        input.customerId,
        input.status,
        input.priority,
        input.scheduledStartAt ?? null,
        input.scheduledEndAt ?? null,
        assignment?.userId ?? null,
        assignment?.userName ?? null,
        nextTeamId,
        completedDate,
        now,
        now,
      );

      upsertDocument(id, input.title, 'custom', `${jobNumber} ${input.title} ${input.description ?? ''}`);
      timeline('job.created', id, {
        jobNumber,
        status: input.status,
      });
      if (input.scheduledStartAt || input.scheduledEndAt) {
        timeline('job.scheduled', id, {
          scheduledStartAt: input.scheduledStartAt ?? null,
          scheduledEndAt: input.scheduledEndAt ?? null,
        });
      }
      if (input.assignedUserId || input.assignedUserName) {
        timeline('job.assignment_updated', id, {
          assignedUserId: assignment?.userId ?? null,
          assignedUserName: assignment?.userName ?? null,
        });
      }
      if (nextTeamId) {
        timeline('job.assignment_scope_set', id, {
          teamId: nextTeamId,
        });
      }
      if (input.status === 'Completed') {
        timeline('job.completed', id, { jobNumber });
      }

      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbJobRow;
      return mapJobRow(row);
    },

    updateJob(id, input) {
      const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbJobRow | undefined;
      if (!existing) {
        throw new Error('Job not found');
      }
      assertValidJobStatusTransitionOrThrow(existing.status, input.status);

      const now = nowIso();
      const completedDate =
        input.status === 'Completed'
          ? (input.completedDate ?? existing.completed_date ?? now)
          : (input.completedDate ?? null);
      const nextScheduledStartAt = input.scheduledStartAt ?? null;
      const nextScheduledEndAt = input.scheduledEndAt ?? null;
      const nextTeamId = input.teamId === undefined ? existing.team_id : input.teamId;
      if (nextTeamId) {
        ensureTeamExistsOrThrow(nextTeamId);
      }
      if (
        (input.assignedUserId === null || input.assignedUserId === undefined) &&
        input.assignedUserName
      ) {
        throw new Error('ASSIGNED_USER_REQUIRES_ID');
      }
      let nextAssignedUserId = existing.assigned_user_id;
      let nextAssignedUserName = existing.assigned_user_name;
      if (input.assignedUserId === null) {
        nextAssignedUserId = null;
        nextAssignedUserName = null;
      } else if (input.assignedUserId !== undefined) {
        const nextAssignment = loadAssignableUserOrThrow(
          input.assignedUserId,
          input.assignedUserName ?? null,
        );
        nextAssignedUserId = nextAssignment.userId;
        nextAssignedUserName = nextAssignment.userName;
      }
      assertAssignmentInTeamScopeOrThrow(
        nextTeamId,
        nextAssignedUserId,
        nextTeamId && nextAssignedUserId ? isUserInTeam(nextTeamId, nextAssignedUserId) : true,
      );
      const statusChanged = existing.status !== input.status;
      const scheduleChanged =
        existing.scheduled_start_at !== nextScheduledStartAt ||
        existing.scheduled_end_at !== nextScheduledEndAt;
      const assignmentChanged =
        existing.assigned_user_id !== nextAssignedUserId ||
        existing.assigned_user_name !== nextAssignedUserName;
      const teamScopeChanged = existing.team_id !== nextTeamId;

      db.prepare(
        `UPDATE jobs
         SET title = ?, description = ?, status = ?, priority = ?, scheduled_start_at = ?, scheduled_end_at = ?, assigned_user_id = ?, assigned_user_name = ?, team_id = ?, completed_date = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.title,
        input.description ?? null,
        input.status,
        input.priority,
        nextScheduledStartAt,
        nextScheduledEndAt,
        nextAssignedUserId,
        nextAssignedUserName,
        nextTeamId,
        completedDate,
        now,
        id,
      );

      upsertDocument(id, input.title, 'custom', `${existing.job_number} ${input.title} ${input.description ?? ''}`);
      timeline('job.updated', id, {
        status: input.status,
      });
      if (statusChanged) {
        timeline('job.status_changed', id, {
          fromStatus: existing.status,
          toStatus: input.status,
        });
      }
      if (scheduleChanged) {
        timeline('job.scheduled', id, {
          scheduledStartAt: nextScheduledStartAt,
          scheduledEndAt: nextScheduledEndAt,
        });
      }
      if (assignmentChanged) {
        timeline('job.assignment_updated', id, {
          assignedUserId: nextAssignedUserId,
          assignedUserName: nextAssignedUserName,
        });
      }
      if (teamScopeChanged) {
        timeline('job.assignment_scope_set', id, {
          teamId: nextTeamId,
        });
      }
      if (existing.status !== 'Completed' && input.status === 'Completed') {
        timeline('job.completed', id, {
          jobNumber: existing.job_number,
        });
      }

      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbJobRow;
      return mapJobRow(row);
    },

    getJobById(id) {
      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbJobRow | undefined;
      return row ? mapJobRow(row) : null;
    },

    listJobs() {
      const rows = db
        .prepare('SELECT * FROM jobs ORDER BY created_at DESC')
        .all() as DbJobRow[];
      return rows.map(mapJobRow);
    },

    linkDocumentToJob(jobId, documentId) {
      const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      const document = db
        .prepare(
          `SELECT
             id,
             document_type AS documentType,
             title,
             entity_id AS entityId,
             searchable_text AS searchableText,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM documents
           WHERE id = ?`,
        )
        .get(documentId) as DocumentRecord | undefined;
      if (!document) {
        throw new Error('Document not found');
      }

      const existing = db
        .prepare('SELECT id FROM job_document_links WHERE job_id = ? AND document_id = ?')
        .get(jobId, documentId) as { id: string } | undefined;
      if (existing) {
        throw new Error('JOB_DOCUMENT_LINK_EXISTS');
      }

      const now = nowIso();
      const linkId = randomUUID();
      db.prepare(
        `INSERT INTO job_document_links (id, job_id, document_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(linkId, jobId, documentId, now);

      timeline('job.document_linked', jobId, { documentId });
      timeline('document.linked_to_job', documentId, { jobId });

      return {
        id: linkId,
        jobId,
        documentId,
        createdAt: now,
        document,
      };
    },

    listJobDocuments(jobId) {
      const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      const rows = db
        .prepare(
          `SELECT
             l.id AS id,
             l.job_id AS jobId,
             l.document_id AS documentId,
             l.created_at AS createdAt,
             d.id AS document_id,
             d.document_type AS document_type,
             d.title AS document_title,
             d.entity_id AS document_entity_id,
             d.searchable_text AS document_searchable_text,
             d.created_at AS document_created_at,
             d.updated_at AS document_updated_at
           FROM job_document_links l
           INNER JOIN documents d ON d.id = l.document_id
           WHERE l.job_id = ?
           ORDER BY l.created_at DESC`,
        )
        .all(jobId) as Array<{
        id: string;
        jobId: string;
        documentId: string;
        createdAt: string;
        document_id: string;
        document_type: string;
        document_title: string;
        document_entity_id: string;
        document_searchable_text: string;
        document_created_at: string;
        document_updated_at: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        documentId: row.documentId,
        createdAt: row.createdAt,
        document: {
          id: row.document_id,
          documentType: row.document_type as DocumentRecord['documentType'],
          title: row.document_title,
          entityId: row.document_entity_id,
          searchableText: row.document_searchable_text,
          createdAt: row.document_created_at,
          updatedAt: row.document_updated_at,
        },
      }));
    },

    getCustomerStatement(customerId, from = null, to = null) {
      const customer = this.getCustomerById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const openingRow = db
        .prepare(
          `SELECT coalesce(sum(total), 0) AS amount
           FROM invoices
           WHERE customer_id = ?
             AND status = 'Finalised'
             AND (? IS NOT NULL AND issue_date < ?)`,
        )
        .get(customerId, from, from) as { amount: number };
      const openingBalance = from ? openingRow.amount : 0;

      const entries = db
        .prepare(
          `SELECT
             id AS invoiceId,
             coalesce(invoice_number, id) AS invoiceNumber,
             issue_date AS issueDate,
             due_date AS dueDate,
             title,
             total
           FROM invoices
           WHERE customer_id = ?
             AND status = 'Finalised'
             AND (? IS NULL OR issue_date >= ?)
             AND (? IS NULL OR issue_date <= ?)
           ORDER BY issue_date ASC, created_at ASC`,
        )
        .all(customerId, from, from, to, to) as CustomerStatementEntry[];

      const periodTotal = entries.reduce((sum, entry) => sum + entry.total, 0);
      const closingBalance = openingBalance + periodTotal;

      return {
        customer,
        generatedAt: nowIso(),
        period: {
          from,
          to,
        },
        openingBalance,
        periodTotal,
        closingBalance,
        entries,
        creditsSupported: false,
        creditsOmittedReason: 'Credits are not supported in the current invoice architecture.',
      };
    },

    getTimelineForEntity(entityType, entityId) {
      return db
        .prepare(
          `SELECT
            id,
            coalesce(event_key, event_type) AS eventKey,
            coalesce(event_version, 1) AS eventVersion,
            coalesce(category, entity_type) AS category,
            entity_type AS entityType,
            entity_id AS entityId,
            coalesce(actor_type, 'system') AS actorType,
            coalesce(source, 'api') AS source,
            event_type AS eventType,
            event_payload AS eventPayload,
            coalesce(payload_schema, 'timeline.legacy.v1') AS payloadSchema,
            created_at AS createdAt
          FROM timeline_events
           WHERE entity_type = ? AND entity_id = ?
           ORDER BY created_at ASC`,
        )
        .all(entityType, entityId) as Array<Record<string, unknown>>;
    },

    search(query) {
      const wildcard = `%${query.toLowerCase()}%`;

      const customers = db
        .prepare(
          `SELECT * FROM customers
           WHERE lower(display_name) LIKE ? OR lower(coalesce(email, '')) LIKE ? OR lower(coalesce(notes, '')) LIKE ?
           ORDER BY updated_at DESC LIMIT 25`,
        )
        .all(wildcard, wildcard, wildcard)
        .map((row: unknown) => mapCustomerRow(row as Record<string, unknown>));

      const invoices = db
        .prepare(
          `SELECT * FROM invoices
           WHERE lower(title) LIKE ? OR lower(coalesce(invoice_number, '')) LIKE ?
           ORDER BY updated_at DESC LIMIT 25`,
        )
        .all(wildcard, wildcard)
        .map((row: unknown) => mapInvoiceRow(row as DbInvoiceRow));

      const documents = db
        .prepare(
          `SELECT
             id,
             document_type AS documentType,
             title,
             entity_id AS entityId,
             searchable_text AS searchableText,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM documents
           WHERE lower(title) LIKE ? OR lower(searchable_text) LIKE ?
           ORDER BY updated_at DESC LIMIT 25`,
        )
        .all(wildcard, wildcard) as DocumentRecord[];

      const jobs = db
        .prepare(
          `SELECT * FROM jobs
           WHERE lower(title) LIKE ?
             OR lower(job_number) LIKE ?
             OR lower(coalesce(description, '')) LIKE ?
             OR lower(coalesce(assigned_user_name, '')) LIKE ?
           ORDER BY updated_at DESC LIMIT 25`,
        )
        .all(wildcard, wildcard, wildcard, wildcard)
        .map((row: unknown) => mapJobRow(row as DbJobRow));

      return { customers, invoices, documents, jobs };
    },
  };
}
