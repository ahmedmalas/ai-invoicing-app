import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

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
  Quote,
  QuoteStatus,
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

function loadSchemaSql(): string {
  try {
    return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8');
    }
    throw error;
  }
}

const schemaSql = loadSchemaSql();

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

interface DbQuoteRow {
  id: string;
  customer_id: string;
  title: string;
  issue_date: string;
  expiry_date: string;
  notes: string | null;
  terms: string | null;
  quote_number: string;
  status: QuoteStatus;
  converted_invoice_id: string | null;
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

export interface CreateQuoteInput {
  customerId: string;
  title: string;
  issueDate: string;
  expiryDate: string;
  notes?: string | undefined;
  terms?: string | undefined;
  lineItems: LineItemInput[];
}

export type UpdateQuoteInput = CreateQuoteInput;

export interface ListInvoicesFilter {
  customerId?: string;
  status?: 'Draft' | 'Finalised';
  paymentState?: PaymentState;
}

export interface ListQuotesFilter {
  customerId?: string;
  status?: QuoteStatus;
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
  suppliers: Supplier[];
  invoices: Array<InvoiceDraft & { creditNoteIds: string[]; customerPaymentIds: string[] }>;
  creditNotes: CreditNote[];
  customerPayments: CustomerPayment[];
  purchaseOrders: Array<PurchaseOrder & { supplierBillIds: string[] }>;
  supplierBills: SupplierBill[];
  supplierPayments: SupplierBillPayment[];
  documents: DocumentRecord[];
  jobs: Job[];
}

type SearchEntityType =
  | 'customers'
  | 'suppliers'
  | 'invoices'
  | 'creditNotes'
  | 'customerPayments'
  | 'purchaseOrders'
  | 'supplierBills'
  | 'supplierPayments'
  | 'documents'
  | 'jobs';

interface SearchQueryOptions {
  limit?: number;
  offset?: number;
  entityTypes?: SearchEntityType[];
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
  lineItems?:
    | Array<{
        purchaseOrderLineItemId: string;
        quantity: number;
      }>
    | undefined;
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

export interface ReportingInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  totalInvoiced: number;
  totalCredited: number;
  totalPaid: number;
  outstanding: number;
}

export interface ReportingCustomerStatementRow {
  customerId: string;
  customerName: string;
  openingBalance: number;
  activity: number;
  closingBalance: number;
}

export interface ReportingPurchaseOrderRow {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  issueDate: string;
  totalOrdered: number;
  totalBilled: number;
  remainingValue: number;
}

export interface ReportingSupplierBillRow {
  supplierBillId: string;
  supplierId: string;
  billNumber: string | null;
  billDate: string;
  status: SupplierBillStatus;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
}

export interface ReportingReadModel {
  generatedAt: string;
  filters: {
    from: string | null;
    to: string | null;
    limit: number;
    offset: number;
  };
  accountsReceivable: {
    totals: {
      totalInvoiced: number;
      totalCredited: number;
      totalPaid: number;
      outstanding: number;
    };
    invoices: ReportingInvoiceRow[];
    customerStatements: ReportingCustomerStatementRow[];
  };
  accountsPayable: {
    totals: {
      totalOrdered: number;
      totalBilled: number;
      totalPaid: number;
      remainingOrderedValue: number;
      supplierBillOutstanding: number;
    };
    purchaseOrders: ReportingPurchaseOrderRow[];
    supplierBills: ReportingSupplierBillRow[];
  };
}

export interface ReportingReadModelQueryOptions {
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

interface TimelineQueryOptions {
  eventKey?: string;
  limit?: number;
  offset?: number;
}

interface ListQueryOptions {
  limit?: number;
  offset?: number;
}

export const DATABASE_SCHEMA_VERSION = 44;
export const PLATFORM_SNAPSHOT_VERSION = 1;

export const PLATFORM_SNAPSHOT_TABLES = [
  'business_profile',
  'preferences',
  'customers',
  'suppliers',
  'roles',
  'users',
  'user_role_links',
  'teams',
  'team_memberships',
  'documents',
  'invoices',
  'invoice_line_items',
  'quotes',
  'quote_line_items',
  'purchase_orders',
  'purchase_order_line_items',
  'supplier_bills',
  'supplier_bill_line_items',
  'jobs',
  'job_document_links',
  'credit_notes',
  'customer_payments',
  'payment_allocations',
  'supplier_payments',
  'supplier_payment_allocations',
  'invoice_snapshots',
  'reminder_states',
  'invoice_sequences',
  'quote_sequences',
  'credit_note_sequences',
  'payment_sequences',
  'supplier_bill_sequences',
  'supplier_payment_sequences',
  'purchase_order_sequences',
  'job_sequences',
  'idempotency_requests',
  'timeline_events',
] as const;

type PlatformSnapshotTable = (typeof PLATFORM_SNAPSHOT_TABLES)[number];
type PlatformSnapshotRow = Record<string, unknown>;

export interface PlatformSnapshot {
  version: number;
  products: PlatformSnapshotRow[];
  derived: {
    customerStatements: Array<{
      customerId: string;
      statement: CustomerStatementReport;
    }>;
  };
  entities: Record<PlatformSnapshotTable, PlatformSnapshotRow[]>;
}

export interface DatabaseOperationalDiagnostics {
  migration: {
    schemaVersion: number;
    userVersion: number;
    compatible: boolean;
  };
  runtime: {
    journalMode: string;
    foreignKeysEnabled: boolean;
    busyTimeoutMs: number;
    quickCheck: string;
  };
  backupRestore: {
    snapshotVersion: number;
    tableCount: number;
  };
}

const platformSnapshotSchema = z.object({
  version: z.number().int(),
  products: z.array(z.record(z.string(), z.unknown())),
  derived: z.object({
    customerStatements: z.array(
      z.object({
        customerId: z.string().uuid(),
        statement: z.unknown(),
      }),
    ),
  }),
  entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export type DatabaseResult<T> = T | Promise<T>;

export interface AppDatabase {
  close(): DatabaseResult<void>;
  getOperationalDiagnostics(): DatabaseResult<DatabaseOperationalDiagnostics>;
  createCustomer(input: CreateCustomerInput): DatabaseResult<Customer>;
  updateCustomer(id: string, input: UpdateCustomerInput): DatabaseResult<Customer>;
  deleteCustomer(id: string): DatabaseResult<void>;
  getCustomerById(id: string): DatabaseResult<Customer | null>;
  listCustomers(options?: ListQueryOptions): DatabaseResult<Customer[]>;
  createSupplier(input: CreateSupplierInput): DatabaseResult<Supplier>;
  deleteSupplier(id: string): DatabaseResult<void>;
  getSupplierById(id: string): DatabaseResult<Supplier | null>;
  listSuppliers(options?: ListQueryOptions): DatabaseResult<Supplier[]>;
  upsertBusinessProfile(input: UpsertBusinessProfileInput): DatabaseResult<BrandingProfile>;
  getBusinessProfile(): DatabaseResult<BrandingProfile | null>;
  upsertPreference(key: string, value: unknown): DatabaseResult<void>;
  getPreference(key: string): DatabaseResult<unknown>;
  createInvoiceDraft(input: CreateInvoiceDraftInput): DatabaseResult<InvoiceDraft>;
  updateInvoiceDraft(id: string, input: UpdateInvoiceDraftInput): DatabaseResult<InvoiceDraft>;
  getInvoiceById(
    id: string,
  ): DatabaseResult<(InvoiceDraft & { lineItems: LineItemInput[] }) | null>;
  listInvoices(
    filter?: ListInvoicesFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<InvoiceDraft[]>;
  deleteInvoiceDraft(id: string): DatabaseResult<void>;
  finaliseInvoice(id: string): DatabaseResult<InvoiceDraft>;
  createQuote(input: CreateQuoteInput): DatabaseResult<Quote>;
  updateQuote(id: string, input: UpdateQuoteInput): DatabaseResult<Quote>;
  getQuoteById(id: string): DatabaseResult<(Quote & { lineItems: LineItemInput[] }) | null>;
  listQuotes(filter?: ListQuotesFilter, options?: ListQueryOptions): DatabaseResult<Quote[]>;
  transitionQuoteStatus(id: string, status: QuoteStatus): DatabaseResult<Quote>;
  deleteQuoteDraft(id: string): DatabaseResult<void>;
  convertQuoteToInvoice(
    id: string,
    dueDate: string,
    paymentTerms?: string,
  ): DatabaseResult<{ quote: Quote; invoice: InvoiceDraft }>;
  createCreditNote(input: CreateCreditNoteInput): DatabaseResult<CreditNote>;
  getCreditNoteById(id: string): DatabaseResult<CreditNote | null>;
  listCreditNotes(
    filter?: ListCreditNotesFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<CreditNote[]>;
  createCustomerPayment(input: CreateCustomerPaymentInput): DatabaseResult<CustomerPayment>;
  getCustomerPaymentById(id: string): DatabaseResult<CustomerPayment | null>;
  listCustomerPayments(
    filter?: ListCustomerPaymentsFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<CustomerPayment[]>;
  createSupplierBillDraft(input: CreateSupplierBillDraftInput): DatabaseResult<SupplierBill>;
  createSupplierBillDraftFromPurchaseOrder(
    purchaseOrderId: string,
    input?: CreateSupplierBillFromPurchaseOrderInput,
  ): DatabaseResult<SupplierBill>;
  deleteSupplierBillDraft(id: string): DatabaseResult<void>;
  updateSupplierBillDraft(
    id: string,
    input: UpdateSupplierBillDraftInput,
  ): DatabaseResult<SupplierBill>;
  getSupplierBillById(
    id: string,
  ): DatabaseResult<(SupplierBill & { lineItems: SupplierBillLineItemInput[] }) | null>;
  finaliseSupplierBill(id: string): DatabaseResult<SupplierBill>;
  listSupplierBills(
    filter?: ListSupplierBillsFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<SupplierBill[]>;
  createSupplierPayment(input: CreateSupplierPaymentInput): DatabaseResult<SupplierBillPayment>;
  getSupplierPaymentById(id: string): DatabaseResult<SupplierBillPayment | null>;
  listSupplierPayments(
    filter?: ListSupplierPaymentsFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<SupplierBillPayment[]>;
  createPurchaseOrderDraft(input: CreatePurchaseOrderDraftInput): DatabaseResult<PurchaseOrder>;
  deletePurchaseOrderDraft(id: string): DatabaseResult<void>;
  updatePurchaseOrderDraft(
    id: string,
    input: UpdatePurchaseOrderDraftInput,
  ): DatabaseResult<PurchaseOrder>;
  getPurchaseOrderById(
    id: string,
  ): DatabaseResult<(PurchaseOrder & { lineItems: PurchaseOrderLineItemInput[] }) | null>;
  approvePurchaseOrder(id: string): DatabaseResult<PurchaseOrder>;
  closePurchaseOrder(id: string, input?: ClosePurchaseOrderInput): DatabaseResult<PurchaseOrder>;
  cancelPurchaseOrder(id: string): DatabaseResult<PurchaseOrder>;
  listPurchaseOrders(
    filter?: ListPurchaseOrdersFilter,
    options?: ListQueryOptions,
  ): DatabaseResult<PurchaseOrder[]>;
  createRole(input: CreateRoleInput): DatabaseResult<Role>;
  deleteRole(id: string): DatabaseResult<void>;
  getRoleById(id: string): DatabaseResult<Role | null>;
  listRoles(options?: ListQueryOptions): DatabaseResult<Role[]>;
  createUser(input: CreateUserInput): DatabaseResult<User>;
  deleteUser(id: string): DatabaseResult<void>;
  getUserById(id: string): DatabaseResult<User | null>;
  listUsers(options?: ListQueryOptions): DatabaseResult<User[]>;
  createTeam(input: CreateTeamInput): DatabaseResult<Team>;
  getTeamById(id: string): DatabaseResult<Team | null>;
  listTeams(options?: ListQueryOptions): DatabaseResult<Team[]>;
  deleteTeam(teamId: string, actorUserId?: string | null): DatabaseResult<void>;
  addTeamMember(
    teamId: string,
    userId: string,
    role?: TeamMembershipRole,
    actorUserId?: string | null,
  ): DatabaseResult<TeamMembershipRecord>;
  removeTeamMember(
    teamId: string,
    userId: string,
    actorUserId?: string | null,
  ): DatabaseResult<void>;
  updateTeamMemberRole(
    teamId: string,
    userId: string,
    role: TeamMembershipRole,
    actorUserId?: string | null,
  ): DatabaseResult<TeamMembershipRecord>;
  listTeamMembers(
    teamId: string,
    options?: ListQueryOptions,
  ): DatabaseResult<TeamMembershipRecord[]>;
  createJob(input: CreateJobInput): DatabaseResult<Job>;
  updateJob(id: string, input: UpdateJobInput): DatabaseResult<Job>;
  getJobById(id: string): DatabaseResult<Job | null>;
  listJobs(options?: ListQueryOptions): DatabaseResult<Job[]>;
  linkDocumentToJob(jobId: string, documentId: string): DatabaseResult<JobDocumentLinkRecord>;
  listJobDocuments(
    jobId: string,
    options?: ListQueryOptions,
  ): DatabaseResult<JobDocumentLinkRecord[]>;
  getCustomerStatement(
    customerId: string,
    from?: string | null,
    to?: string | null,
  ): DatabaseResult<CustomerStatementReport>;
  getReportingReadModel(
    options?: ReportingReadModelQueryOptions,
  ): DatabaseResult<ReportingReadModel>;
  getTimelineForEntity(
    entityType: string,
    entityId: string,
    options?: TimelineQueryOptions,
  ): DatabaseResult<Array<Record<string, unknown>>>;
  search(query: string, options?: SearchQueryOptions): DatabaseResult<SearchResults>;
  exportPlatformSnapshot(): DatabaseResult<PlatformSnapshot>;
  restorePlatformSnapshot(snapshot: unknown): DatabaseResult<void>;
}

export interface DatabaseInitOptions {
  busyTimeoutMs?: number;
}

export type SqliteAppDatabase = {
  [Method in keyof AppDatabase]: AppDatabase[Method] extends (
    ...args: infer Arguments
  ) => DatabaseResult<infer Result>
    ? (...args: Arguments) => Result
    : never;
};

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

function mapQuoteRow(row: DbQuoteRow): Quote {
  return {
    id: row.id,
    customerId: row.customer_id,
    title: row.title,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    notes: row.notes,
    terms: row.terms,
    quoteNumber: row.quote_number,
    status: row.status,
    convertedInvoiceId: row.converted_invoice_id,
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

export function createDatabase(
  dbPath: string,
  options: DatabaseInitOptions = {},
): SqliteAppDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  const busyTimeoutMs = Math.max(1000, Math.trunc(options.busyTimeoutMs ?? 5000));
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(schemaSql);

  function ensureSchemaVersionCompatibilityOrThrow(): {
    schemaVersion: number;
    userVersion: number;
  } {
    const userVersionRaw = db.pragma('user_version', { simple: true });
    const userVersion =
      typeof userVersionRaw === 'number' ? userVersionRaw : Number(userVersionRaw ?? 0);
    if (userVersion > DATABASE_SCHEMA_VERSION) {
      throw new Error('DB_SCHEMA_VERSION_UNSUPPORTED');
    }
    if (userVersion < DATABASE_SCHEMA_VERSION) {
      db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    }
    return {
      schemaVersion: DATABASE_SCHEMA_VERSION,
      userVersion: Math.max(userVersion, DATABASE_SCHEMA_VERSION),
    };
  }
  let schemaVersionState: ReturnType<typeof ensureSchemaVersionCompatibilityOrThrow>;
  try {
    schemaVersionState = ensureSchemaVersionCompatibilityOrThrow();
  } catch (error) {
    db.close();
    throw error;
  }

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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_jobs_team_assigned_user ON jobs(team_id, assigned_user_id);',
  );

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
  const supplierBillLineItemColumnSet = new Set(
    supplierBillLineItemColumns.map((column) => column.name),
  );
  if (!supplierBillLineItemColumnSet.has('source_purchase_order_line_item_id')) {
    db.exec(
      'ALTER TABLE supplier_bill_line_items ADD COLUMN source_purchase_order_line_item_id TEXT;',
    );
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
      { 1: number } | undefined;
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

  type DocumentSequenceTable =
    | 'invoice_sequences'
    | 'quote_sequences'
    | 'credit_note_sequences'
    | 'payment_sequences'
    | 'purchase_order_sequences'
    | 'supplier_bill_sequences'
    | 'supplier_payment_sequences';

  const getNextDocumentSequence = db.transaction(
    (
      table: DocumentSequenceTable,
      fallbackPrefix: string,
    ): { prefix: string; year: number; sequence: number } => {
      const currentYear = new Date().getUTCFullYear();
      db.prepare(
        `INSERT INTO ${table} (id, prefix, year, next_sequence)
         VALUES (1, ?, ?, 1)
         ON CONFLICT(id) DO NOTHING`,
      ).run(fallbackPrefix, currentYear);

      const sequenceRow = db
        .prepare(`SELECT prefix, year, next_sequence FROM ${table} WHERE id = 1`)
        .get() as { prefix: string; year: number; next_sequence: number } | undefined;
      if (!sequenceRow) {
        throw new Error('DOCUMENT_NUMBER_SEQUENCE_INVALID_STATE');
      }

      if (!Number.isInteger(sequenceRow.next_sequence) || sequenceRow.next_sequence < 1) {
        throw new Error('DOCUMENT_NUMBER_SEQUENCE_INVALID_STATE');
      }

      const prefix = sequenceRow.prefix?.trim() || fallbackPrefix;
      let sequence = sequenceRow.next_sequence;

      if (sequenceRow.year !== currentYear) {
        sequence = 1;
        db.prepare(`UPDATE ${table} SET year = ?, next_sequence = ? WHERE id = 1`).run(
          currentYear,
          2,
        );
      } else {
        db.prepare(`UPDATE ${table} SET next_sequence = ? WHERE id = 1`).run(sequence + 1);
      }

      return { prefix, year: currentYear, sequence };
    },
  );

  function allocateDocumentNumber(table: DocumentSequenceTable, fallbackPrefix: string): string {
    const nextSequence = getNextDocumentSequence(table, fallbackPrefix);
    return formatInvoiceNumber(nextSequence.prefix, nextSequence.year, nextSequence.sequence);
  }

  const listRoleIdsForUser = db.prepare(
    'SELECT role_id FROM user_role_links WHERE user_id = ? ORDER BY created_at ASC, id ASC',
  );

  function getRoleIdsForUser(userId: string): string[] {
    const rows = listRoleIdsForUser.all(userId) as Array<{ role_id: string }>;
    return rows.map((row) => row.role_id);
  }

  function getRoleIdsForUsers(userIds: string[]): Map<string, string[]> {
    if (userIds.length === 0) {
      return new Map();
    }
    const placeholders = userIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT user_id, role_id
         FROM user_role_links
         WHERE user_id IN (${placeholders})
         ORDER BY user_id ASC, created_at ASC, id ASC`,
      )
      .all(...userIds) as Array<{ user_id: string; role_id: string }>;
    const roleIdsByUser = new Map<string, string[]>();
    for (const row of rows) {
      const existing = roleIdsByUser.get(row.user_id) ?? [];
      existing.push(row.role_id);
      roleIdsByUser.set(row.user_id, existing);
    }
    return roleIdsByUser;
  }

  function getAllocationsForPayment(paymentId: string): PaymentAllocation[] {
    const rows = db
      .prepare(
        `SELECT invoice_id, amount
         FROM payment_allocations
         WHERE payment_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(paymentId) as Array<{ invoice_id: string; amount: number }>;
    return rows.map((row) => ({
      invoiceId: row.invoice_id,
      amount: row.amount,
    }));
  }

  function getAllocationsForSupplierPayment(
    supplierPaymentId: string,
  ): SupplierPaymentAllocation[] {
    const rows = db
      .prepare(
        `SELECT supplier_bill_id, amount
         FROM supplier_payment_allocations
         WHERE supplier_payment_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(supplierPaymentId) as Array<{ supplier_bill_id: string; amount: number }>;
    return rows.map((row) => ({
      supplierBillId: row.supplier_bill_id,
      amount: row.amount,
    }));
  }

  function getPurchaseOrderBillingSummary(
    purchaseOrderId: string,
    purchaseOrderTotal: number,
  ): {
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

  function mapBilledAmountByPurchaseOrderId(purchaseOrderIds: string[]): Map<string, number> {
    if (purchaseOrderIds.length === 0) {
      return new Map();
    }
    const placeholders = purchaseOrderIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT source_purchase_order_id AS purchase_order_id, coalesce(sum(total), 0) AS total_billed
         FROM supplier_bills
         WHERE source_purchase_order_id IN (${placeholders})
         GROUP BY source_purchase_order_id`,
      )
      .all(...purchaseOrderIds) as Array<{ purchase_order_id: string; total_billed: number }>;
    return new Map(rows.map((row) => [row.purchase_order_id, Number(row.total_billed ?? 0)]));
  }

  function mapPaymentAllocationsByPaymentId(
    paymentIds: string[],
  ): Map<string, PaymentAllocation[]> {
    if (paymentIds.length === 0) {
      return new Map();
    }
    const placeholders = paymentIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT payment_id, invoice_id, amount
         FROM payment_allocations
         WHERE payment_id IN (${placeholders})
         ORDER BY payment_id ASC, created_at ASC, id ASC`,
      )
      .all(...paymentIds) as Array<{ payment_id: string; invoice_id: string; amount: number }>;
    const allocationsByPaymentId = new Map<string, PaymentAllocation[]>();
    for (const row of rows) {
      const existing = allocationsByPaymentId.get(row.payment_id) ?? [];
      existing.push({ invoiceId: row.invoice_id, amount: row.amount });
      allocationsByPaymentId.set(row.payment_id, existing);
    }
    return allocationsByPaymentId;
  }

  function mapSupplierPaymentAllocationsByPaymentId(
    supplierPaymentIds: string[],
  ): Map<string, SupplierPaymentAllocation[]> {
    if (supplierPaymentIds.length === 0) {
      return new Map();
    }
    const placeholders = supplierPaymentIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT supplier_payment_id, supplier_bill_id, amount
         FROM supplier_payment_allocations
         WHERE supplier_payment_id IN (${placeholders})
         ORDER BY supplier_payment_id ASC, created_at ASC, id ASC`,
      )
      .all(...supplierPaymentIds) as Array<{
      supplier_payment_id: string;
      supplier_bill_id: string;
      amount: number;
    }>;
    const allocationsByPaymentId = new Map<string, SupplierPaymentAllocation[]>();
    for (const row of rows) {
      const existing = allocationsByPaymentId.get(row.supplier_payment_id) ?? [];
      existing.push({ supplierBillId: row.supplier_bill_id, amount: row.amount });
      allocationsByPaymentId.set(row.supplier_payment_id, existing);
    }
    return allocationsByPaymentId;
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
    const globalAdminRole = db
      .prepare(
        `SELECT 1
         FROM user_role_links url
         INNER JOIN roles r ON r.id = url.role_id
         WHERE url.user_id = ? AND r.can_manage_assignments = 1
         LIMIT 1`,
      )
      .get(actorUserId);
    if (globalAdminRole) {
      return;
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

  function getTableColumns(table: PlatformSnapshotTable): string[] {
    return (
      db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>
    ).map((column) => column.name);
  }

  function snapshotTableRows(table: PlatformSnapshotTable): PlatformSnapshotRow[] {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all() as PlatformSnapshotRow[];
  }

  function parseAndValidateSnapshot(snapshot: unknown): PlatformSnapshot {
    let parsed: z.infer<typeof platformSnapshotSchema>;
    try {
      parsed = platformSnapshotSchema.parse(snapshot);
    } catch {
      throw new Error('BACKUP_RESTORE_MALFORMED_PAYLOAD');
    }
    if (parsed.version !== PLATFORM_SNAPSHOT_VERSION) {
      throw new Error('BACKUP_RESTORE_INCOMPATIBLE_VERSION');
    }

    parsed.entities.quotes ??= [];
    parsed.entities.quote_line_items ??= [];
    parsed.entities.quote_sequences ??= [];

    const entities = {} as Record<PlatformSnapshotTable, PlatformSnapshotRow[]>;
    for (const table of PLATFORM_SNAPSHOT_TABLES) {
      const rows = parsed.entities[table];
      if (!Array.isArray(rows)) {
        throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
      }
      entities[table] = rows.map((row) => ({ ...row }));
    }

    return {
      version: parsed.version,
      products: parsed.products.map((row) => ({ ...row })),
      derived: {
        customerStatements: parsed.derived.customerStatements.map((entry) => ({
          customerId: entry.customerId,
          statement: entry.statement as CustomerStatementReport,
        })),
      },
      entities,
    };
  }

  function assertRestoreTargetIsEmptyOrThrow() {
    for (const table of PLATFORM_SNAPSHOT_TABLES) {
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      if (count.count > 0) {
        throw new Error('BACKUP_RESTORE_TARGET_NOT_EMPTY');
      }
    }
  }

  function insertSnapshotRows(
    table: PlatformSnapshotTable,
    rows: PlatformSnapshotRow[],
    transform?: (row: PlatformSnapshotRow) => PlatformSnapshotRow,
  ) {
    if (rows.length < 1) {
      return;
    }

    const columns = getTableColumns(table);
    const statement = db.prepare(
      `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
    );

    for (const sourceRow of rows) {
      const row = transform ? transform(sourceRow) : sourceRow;
      for (const column of columns) {
        if (!Object.prototype.hasOwnProperty.call(row, column)) {
          throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
        }
      }
      statement.run(...columns.map((column) => row[column] ?? null));
    }
  }

  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }

  function withIdempotentCreate<T>(operation: string, payload: unknown, execute: () => T): T {
    const fingerprint = createHash('sha256')
      .update(operation)
      .update(':')
      .update(stableStringify(payload))
      .digest('hex');

    const existing = db
      .prepare(
        `SELECT response_json
         FROM idempotency_requests
         WHERE operation = ? AND fingerprint = ?`,
      )
      .get(operation, fingerprint) as { response_json: string } | undefined;
    if (existing) {
      return JSON.parse(existing.response_json) as T;
    }

    const result = execute();
    db.prepare(
      `INSERT INTO idempotency_requests (operation, fingerprint, response_json, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(operation, fingerprint, JSON.stringify(result), nowIso());
    return result;
  }

  function assertNoInjectedFailure(failpoint: string): void {
    if (process.env.AI_BUSINESS_OS_FAILPOINT === failpoint) {
      throw new Error(`INJECTED_FAILURE_${failpoint}`);
    }
  }

  const restorePlatformSnapshot = db.transaction((snapshot: PlatformSnapshot) => {
    assertRestoreTargetIsEmptyOrThrow();

    insertSnapshotRows('business_profile', snapshot.entities.business_profile);
    insertSnapshotRows('preferences', snapshot.entities.preferences);
    insertSnapshotRows('customers', snapshot.entities.customers);
    insertSnapshotRows('suppliers', snapshot.entities.suppliers);
    insertSnapshotRows('roles', snapshot.entities.roles);
    insertSnapshotRows('users', snapshot.entities.users);
    insertSnapshotRows('user_role_links', snapshot.entities.user_role_links);
    insertSnapshotRows('teams', snapshot.entities.teams);
    insertSnapshotRows('team_memberships', snapshot.entities.team_memberships);
    insertSnapshotRows('documents', snapshot.entities.documents);

    insertSnapshotRows('invoices', snapshot.entities.invoices, (row) => ({
      ...row,
      status: 'Draft',
    }));
    insertSnapshotRows('invoice_line_items', snapshot.entities.invoice_line_items);
    insertSnapshotRows('quotes', snapshot.entities.quotes);
    insertSnapshotRows('quote_line_items', snapshot.entities.quote_line_items);
    insertSnapshotRows('purchase_orders', snapshot.entities.purchase_orders, (row) => ({
      ...row,
      status: 'Draft',
    }));
    insertSnapshotRows('purchase_order_line_items', snapshot.entities.purchase_order_line_items);
    insertSnapshotRows('supplier_bills', snapshot.entities.supplier_bills, (row) => ({
      ...row,
      status: 'Draft',
    }));
    insertSnapshotRows('supplier_bill_line_items', snapshot.entities.supplier_bill_line_items);

    insertSnapshotRows('jobs', snapshot.entities.jobs);
    insertSnapshotRows('job_document_links', snapshot.entities.job_document_links);
    insertSnapshotRows('credit_notes', snapshot.entities.credit_notes);
    insertSnapshotRows('customer_payments', snapshot.entities.customer_payments);
    insertSnapshotRows('payment_allocations', snapshot.entities.payment_allocations);
    insertSnapshotRows('supplier_payments', snapshot.entities.supplier_payments);
    insertSnapshotRows(
      'supplier_payment_allocations',
      snapshot.entities.supplier_payment_allocations,
    );

    insertSnapshotRows('invoice_sequences', snapshot.entities.invoice_sequences);
    insertSnapshotRows('quote_sequences', snapshot.entities.quote_sequences);
    insertSnapshotRows('credit_note_sequences', snapshot.entities.credit_note_sequences);
    insertSnapshotRows('payment_sequences', snapshot.entities.payment_sequences);
    insertSnapshotRows('supplier_bill_sequences', snapshot.entities.supplier_bill_sequences);
    insertSnapshotRows('supplier_payment_sequences', snapshot.entities.supplier_payment_sequences);
    insertSnapshotRows('purchase_order_sequences', snapshot.entities.purchase_order_sequences);
    insertSnapshotRows('job_sequences', snapshot.entities.job_sequences);
    insertSnapshotRows('idempotency_requests', snapshot.entities.idempotency_requests);

    for (const row of snapshot.entities.invoices) {
      if (typeof row.id !== 'string' || typeof row.status !== 'string') {
        throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
      }
      db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(row.status, row.id);
    }
    for (const row of snapshot.entities.purchase_orders) {
      if (typeof row.id !== 'string' || typeof row.status !== 'string') {
        throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
      }
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(row.status, row.id);
    }
    for (const row of snapshot.entities.supplier_bills) {
      if (typeof row.id !== 'string' || typeof row.status !== 'string') {
        throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
      }
      db.prepare('UPDATE supplier_bills SET status = ? WHERE id = ?').run(row.status, row.id);
    }

    insertSnapshotRows('invoice_snapshots', snapshot.entities.invoice_snapshots);
    insertSnapshotRows('reminder_states', snapshot.entities.reminder_states);
    insertSnapshotRows('timeline_events', snapshot.entities.timeline_events);

    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all() as Array<
      Record<string, unknown>
    >;
    if (foreignKeyViolations.length > 0) {
      throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
    }
  });

  return {
    close() {
      db.close();
    },

    getOperationalDiagnostics() {
      schemaVersionState = ensureSchemaVersionCompatibilityOrThrow();
      const journalModeRaw = db.pragma('journal_mode', { simple: true });
      const foreignKeysRaw = db.pragma('foreign_keys', { simple: true });
      const quickCheckRow = db.prepare('PRAGMA quick_check').get() as
        { quick_check?: string } | undefined;
      return {
        migration: {
          schemaVersion: schemaVersionState.schemaVersion,
          userVersion: schemaVersionState.userVersion,
          compatible: schemaVersionState.schemaVersion === schemaVersionState.userVersion,
        },
        runtime: {
          journalMode:
            typeof journalModeRaw === 'string'
              ? journalModeRaw
              : typeof journalModeRaw === 'number'
                ? `${journalModeRaw}`
                : 'unknown',
          foreignKeysEnabled: Number(foreignKeysRaw ?? 0) === 1,
          busyTimeoutMs,
          quickCheck: quickCheckRow?.quick_check ?? 'unknown',
        },
        backupRestore: {
          snapshotVersion: PLATFORM_SNAPSHOT_VERSION,
          tableCount: PLATFORM_SNAPSHOT_TABLES.length,
        },
      };
    },

    createCustomer(input) {
      return db.transaction((txInput: CreateCustomerInput) =>
        withIdempotentCreate<Customer>('createCustomer', txInput, () => {
          const id = randomUUID();
          const now = nowIso();
          db.prepare(
            `INSERT INTO customers (id, display_name, email, phone, address, abn_tax_id, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            txInput.displayName,
            txInput.email ?? null,
            txInput.phone ?? null,
            txInput.address ?? null,
            txInput.abnTaxId ?? null,
            txInput.notes ?? null,
            now,
            now,
          );
          assertNoInjectedFailure('create_customer_after_insert');
          const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<
            string,
            unknown
          >;
          timeline('customer.created', id, { displayName: txInput.displayName });
          return mapCustomerRow(row);
        }),
      )(input);
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
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<
        string,
        unknown
      >;
      timeline('customer.updated', id, { displayName: input.displayName });
      return mapCustomerRow(row);
    },

    deleteCustomer(id) {
      return db.transaction((customerId: string) => {
        const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
        if (!existing) {
          throw new Error('Customer not found');
        }

        const invoiceCount = db
          .prepare('SELECT count(*) AS count FROM invoices WHERE customer_id = ?')
          .get(customerId) as { count: number };
        if (invoiceCount.count > 0) {
          throw new Error('CUSTOMER_HAS_INVOICES');
        }

        const quoteCount = db
          .prepare('SELECT count(*) AS count FROM quotes WHERE customer_id = ?')
          .get(customerId) as { count: number };
        if (quoteCount.count > 0) {
          throw new Error('CUSTOMER_HAS_QUOTES');
        }

        const paymentCount = db
          .prepare('SELECT count(*) AS count FROM customer_payments WHERE customer_id = ?')
          .get(customerId) as { count: number };
        if (paymentCount.count > 0) {
          throw new Error('CUSTOMER_HAS_PAYMENTS');
        }

        const creditNoteCount = db
          .prepare('SELECT count(*) AS count FROM credit_notes WHERE customer_id = ?')
          .get(customerId) as { count: number };
        if (creditNoteCount.count > 0) {
          throw new Error('CUSTOMER_HAS_CREDIT_NOTES');
        }

        const jobCount = db
          .prepare('SELECT count(*) AS count FROM jobs WHERE customer_id = ?')
          .get(customerId) as { count: number };
        if (jobCount.count > 0) {
          throw new Error('CUSTOMER_HAS_JOBS');
        }

        db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
      })(id);
    },

    getCustomerById(id) {
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
        Record<string, unknown> | undefined;
      return row ? mapCustomerRow(row) : null;
    },

    listCustomers(options) {
      const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = options?.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM customers ORDER BY display_name ASC, created_at DESC, id DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as Array<Record<string, unknown>>;
      return rows.map(mapCustomerRow);
    },

    createSupplier(input) {
      return db.transaction((txInput: CreateSupplierInput) =>
        withIdempotentCreate<Supplier>('createSupplier', txInput, () => {
          const id = randomUUID();
          const now = nowIso();
          db.prepare(
            `INSERT INTO suppliers (id, display_name, email, phone, address, tax_id, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            txInput.displayName,
            txInput.email ?? null,
            txInput.phone ?? null,
            txInput.address ?? null,
            txInput.taxId ?? null,
            txInput.notes ?? null,
            now,
            now,
          );
          assertNoInjectedFailure('create_supplier_after_insert');
          const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as DbSupplierRow;
          return mapSupplierRow(row);
        }),
      )(input);
    },

    deleteSupplier(id) {
      return db.transaction((supplierId: string) => {
        const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId);
        if (!existing) {
          throw new Error('Supplier not found');
        }

        const poCount = db
          .prepare('SELECT count(*) AS count FROM purchase_orders WHERE supplier_id = ?')
          .get(supplierId) as { count: number };
        if (poCount.count > 0) {
          throw new Error('SUPPLIER_HAS_PURCHASE_ORDERS');
        }

        const billCount = db
          .prepare('SELECT count(*) AS count FROM supplier_bills WHERE supplier_id = ?')
          .get(supplierId) as { count: number };
        if (billCount.count > 0) {
          throw new Error('SUPPLIER_HAS_BILLS');
        }

        const paymentCount = db
          .prepare('SELECT count(*) AS count FROM supplier_payments WHERE supplier_id = ?')
          .get(supplierId) as { count: number };
        if (paymentCount.count > 0) {
          throw new Error('SUPPLIER_HAS_PAYMENTS');
        }

        db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplierId);
      })(id);
    },

    getSupplierById(id) {
      const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
        DbSupplierRow | undefined;
      return row ? mapSupplierRow(row) : null;
    },

    listSuppliers(options) {
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM suppliers ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as DbSupplierRow[];
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

      const row = db
        .prepare('SELECT * FROM business_profile WHERE id = ?')
        .get(profileId) as Record<string, unknown>;
      timeline('business_profile.updated', profileId, {
        companyName: input.companyName,
      });
      return mapBusinessProfileRow(row);
    },

    getBusinessProfile() {
      const row = db
        .prepare('SELECT * FROM business_profile WHERE id = ?')
        .get('business-profile') as Record<string, unknown> | undefined;
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
      return db.transaction((txInput: CreateInvoiceDraftInput) =>
        withIdempotentCreate<InvoiceDraft>('createInvoiceDraft', txInput, () => {
          const customer = db
            .prepare('SELECT id FROM customers WHERE id = ?')
            .get(txInput.customerId);
          if (!customer) {
            throw new Error('Customer not found');
          }
          const id = randomUUID();
          const now = nowIso();
          const { totals } = calculateTotals(txInput.lineItems);

          db.prepare(
            `INSERT INTO invoices (id, customer_id, title, issue_date, due_date, notes, payment_terms, invoice_number, status, payment_state, reminder_state, subtotal, gst_total, total, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            txInput.customerId,
            txInput.title,
            txInput.issueDate,
            txInput.dueDate,
            txInput.notes ?? null,
            txInput.paymentTerms ?? null,
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
          assertNoInjectedFailure('create_invoice_after_insert');

          const insertLine = db.prepare(
            `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const { calculatedItems } = calculateTotals(txInput.lineItems);
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

          assertNoInjectedFailure('create_invoice_after_line_items');
          upsertDocument(id, txInput.title, 'invoice', `${txInput.title} ${txInput.notes ?? ''}`);
          timeline('invoice.draft_created', id, { totals, lineItems: txInput.lineItems.length });

          const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as DbInvoiceRow;
          return mapInvoiceRow(row);
        }),
      )(input);
    },

    updateInvoiceDraft(id, input) {
      return db.transaction((invoiceId: string, txInput: UpdateInvoiceDraftInput) => {
        const existing = db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId) as
          { status: string } | undefined;
        if (!existing) {
          throw new Error('Invoice not found');
        }
        if (existing.status !== 'Draft') {
          throw new Error('Only draft invoices can be edited');
        }

        const { totals } = calculateTotals(txInput.lineItems);
        db.prepare(
          `UPDATE invoices
           SET title = ?, issue_date = ?, due_date = ?, notes = ?, payment_terms = ?, payment_state = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          txInput.title,
          txInput.issueDate,
          txInput.dueDate,
          txInput.notes ?? null,
          txInput.paymentTerms ?? null,
          txInput.paymentState,
          totals.subtotal,
          totals.gstTotal,
          totals.total,
          nowIso(),
          invoiceId,
        );

        db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(invoiceId);
        const insertLine = db.prepare(
          `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const { calculatedItems } = calculateTotals(txInput.lineItems);
        for (const item of calculatedItems) {
          insertLine.run(
            randomUUID(),
            invoiceId,
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
          invoiceId,
          txInput.title,
          'invoice',
          `${txInput.title} ${txInput.notes ?? ''}`,
        );
        timeline('invoice.draft_updated', invoiceId, {
          totals,
          lineItems: txInput.lineItems.length,
        });

        const row = db
          .prepare('SELECT * FROM invoices WHERE id = ?')
          .get(invoiceId) as DbInvoiceRow;
        return mapInvoiceRow(row);
      })(id, input);
    },

    getInvoiceById(id) {
      const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
        DbInvoiceRow | undefined;
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

    listInvoices(filter, options) {
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (filter?.customerId) {
        clauses.push('customer_id = ?');
        params.push(filter.customerId);
      }
      if (filter?.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter?.paymentState) {
        clauses.push('payment_state = ?');
        params.push(filter.paymentState);
      }
      const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = options?.offset ?? 0;
      params.push(limit, offset);
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM invoices${where} ORDER BY issue_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params) as DbInvoiceRow[];
      return rows.map(mapInvoiceRow);
    },

    deleteInvoiceDraft(id) {
      return db.transaction((invoiceId: string) => {
        const row = db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId) as
          { status: string } | undefined;
        if (!row) throw new Error('Invoice not found');
        if (row.status !== 'Draft') throw new Error('Only draft invoices can be deleted');
        db.prepare('DELETE FROM job_document_links WHERE document_id = ?').run(invoiceId);
        db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(invoiceId);
        db.prepare('DELETE FROM documents WHERE id = ?').run(invoiceId);
        db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
      })(id);
    },

    finaliseInvoice(id) {
      return db.transaction((invoiceId: string) => {
        const invoice = this.getInvoiceById(invoiceId);
        if (!invoice) {
          throw new Error('Invoice not found');
        }
        if (invoice.status !== 'Draft') {
          throw new Error('Invoice already finalised');
        }

        const invoiceNumber = allocateDocumentNumber('invoice_sequences', 'INV');
        const now = nowIso();
        upsertDocument(
          invoiceId,
          `${invoiceNumber} ${invoice.title}`,
          'invoice',
          `${invoiceNumber} ${invoice.title} ${invoice.notes ?? ''}`,
        );
        try {
          db.prepare(
            `UPDATE invoices
             SET status = 'Finalised', invoice_number = ?, payment_state = 'Awaiting Payment', updated_at = ?
             WHERE id = ?`,
          ).run(invoiceNumber, now, invoiceId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message.includes('uq_invoices_number_not_null') ||
            message.includes('UNIQUE constraint failed: invoices.invoice_number')
          ) {
            throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
          }
          throw error;
        }

        const finalised = this.getInvoiceById(invoiceId);
        if (!finalised) {
          throw new Error('Failed to load finalised invoice');
        }

        db.prepare(
          `INSERT INTO invoice_snapshots (id, invoice_id, snapshot_json, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), invoiceId, JSON.stringify(finalised), now);

        assertNoInjectedFailure('finalise_invoice_after_snapshot');
        timeline('invoice.finalised', invoiceId, {
          invoiceNumber,
          total: finalised.totals.total,
        });

        return finalised;
      })(id);
    },

    createQuote(input) {
      return db.transaction((txInput: CreateQuoteInput) => {
        const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(txInput.customerId);
        if (!customer) throw new Error('Customer not found');
        const id = randomUUID();
        const now = nowIso();
        const quoteNumber = allocateDocumentNumber('quote_sequences', 'QUO');
        const { totals, calculatedItems } = calculateTotals(txInput.lineItems);
        db.prepare(
          `INSERT INTO quotes (id, customer_id, title, issue_date, expiry_date, notes, terms, quote_number, status, converted_invoice_id, subtotal, gst_total, total, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft', NULL, ?, ?, ?, ?, ?)`,
        ).run(id, txInput.customerId, txInput.title, txInput.issueDate, txInput.expiryDate, txInput.notes ?? null, txInput.terms ?? null, quoteNumber, totals.subtotal, totals.gstTotal, totals.total, now, now);
        const insertLine = db.prepare(
          `INSERT INTO quote_line_items (id, quote_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of calculatedItems) {
          insertLine.run(randomUUID(), id, item.description, item.quantity, item.unitPrice, item.gstApplicable ? 1 : 0, item.lineSubtotal, item.lineGst, item.lineTotal);
        }
        upsertDocument(id, `${quoteNumber} ${txInput.title}`, 'quote', `${quoteNumber} ${txInput.title} ${txInput.notes ?? ''}`);
        const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as DbQuoteRow;
        return mapQuoteRow(row);
      })(input);
    },

    updateQuote(id, input) {
      return db.transaction((quoteId: string, txInput: UpdateQuoteInput) => {
        const existing = db.prepare('SELECT status, quote_number FROM quotes WHERE id = ?').get(quoteId) as { status: QuoteStatus; quote_number: string } | undefined;
        if (!existing) throw new Error('Quote not found');
        if (existing.status !== 'Draft') throw new Error('Only draft quotes can be edited');
        const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(txInput.customerId);
        if (!customer) throw new Error('Customer not found');
        const { totals, calculatedItems } = calculateTotals(txInput.lineItems);
        db.prepare(
          `UPDATE quotes SET customer_id = ?, title = ?, issue_date = ?, expiry_date = ?, notes = ?, terms = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ? WHERE id = ?`,
        ).run(txInput.customerId, txInput.title, txInput.issueDate, txInput.expiryDate, txInput.notes ?? null, txInput.terms ?? null, totals.subtotal, totals.gstTotal, totals.total, nowIso(), quoteId);
        db.prepare('DELETE FROM quote_line_items WHERE quote_id = ?').run(quoteId);
        const insertLine = db.prepare(
          `INSERT INTO quote_line_items (id, quote_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of calculatedItems) {
          insertLine.run(randomUUID(), quoteId, item.description, item.quantity, item.unitPrice, item.gstApplicable ? 1 : 0, item.lineSubtotal, item.lineGst, item.lineTotal);
        }
        upsertDocument(quoteId, `${existing.quote_number} ${txInput.title}`, 'quote', `${existing.quote_number} ${txInput.title} ${txInput.notes ?? ''}`);
        const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as DbQuoteRow;
        return mapQuoteRow(row);
      })(id, input);
    },

    getQuoteById(id) {
      const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as DbQuoteRow | undefined;
      if (!row) return null;
      const lineRows = db.prepare('SELECT description, quantity, unit_price, gst_applicable FROM quote_line_items WHERE quote_id = ? ORDER BY rowid ASC').all(id) as DbInvoiceLineItem[];
      return {
        ...mapQuoteRow(row),
        lineItems: lineRows.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unit_price, gstApplicable: item.gst_applicable === 1 })),
      };
    },

    listQuotes(filter, options) {
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (filter?.customerId) {
        clauses.push('customer_id = ?');
        params.push(filter.customerId);
      }
      if (filter?.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      params.push(options?.limit ?? Number.MAX_SAFE_INTEGER, options?.offset ?? 0);
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM quotes${where} ORDER BY issue_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params) as DbQuoteRow[];
      return rows.map(mapQuoteRow);
    },

    transitionQuoteStatus(id, status) {
      return db.transaction((quoteId: string, nextStatus: QuoteStatus) => {
        const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as DbQuoteRow | undefined;
        if (!row) throw new Error('Quote not found');
        if (row.status === nextStatus) return mapQuoteRow(row);
        const allowed: Record<QuoteStatus, QuoteStatus[]> = {
          Draft: ['Sent', 'Declined', 'Expired'],
          Sent: ['Accepted', 'Declined', 'Expired'],
          Accepted: [],
          Declined: [],
          Expired: [],
          Converted: [],
        };
        if (!allowed[row.status].includes(nextStatus)) throw new Error('INVALID_QUOTE_STATUS_TRANSITION');
        db.prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, nowIso(), quoteId);
        const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as DbQuoteRow;
        return mapQuoteRow(updated);
      })(id, status);
    },

    deleteQuoteDraft(id) {
      return db.transaction((quoteId: string) => {
        const row = db.prepare('SELECT status FROM quotes WHERE id = ?').get(quoteId) as { status: QuoteStatus } | undefined;
        if (!row) throw new Error('Quote not found');
        if (row.status !== 'Draft') throw new Error('Only draft quotes can be deleted');
        db.prepare('DELETE FROM job_document_links WHERE document_id = ?').run(quoteId);
        db.prepare('DELETE FROM quote_line_items WHERE quote_id = ?').run(quoteId);
        db.prepare('DELETE FROM documents WHERE id = ?').run(quoteId);
        db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);
      })(id);
    },

    convertQuoteToInvoice(id, dueDate, paymentTerms) {
      return db.transaction((quoteId: string) => {
        const quote = this.getQuoteById(quoteId);
        if (!quote) throw new Error('Quote not found');
        if (quote.status !== 'Accepted') throw new Error('QUOTE_MUST_BE_ACCEPTED_BEFORE_CONVERSION');
        const invoice = this.createInvoiceDraft({ customerId: quote.customerId, title: quote.title, issueDate: nowIso().slice(0, 10), dueDate, notes: quote.notes ?? undefined, paymentTerms: paymentTerms ?? quote.terms ?? undefined, lineItems: quote.lineItems });
        db.prepare("UPDATE quotes SET status = 'Converted', converted_invoice_id = ?, updated_at = ? WHERE id = ?").run(invoice.id, nowIso(), quoteId);
        const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as DbQuoteRow;
        return { quote: mapQuoteRow(updated), invoice };
      })(id);
    },

    createCreditNote(input) {
      return db.transaction((txInput: CreateCreditNoteInput) =>
        withIdempotentCreate<CreditNote>('createCreditNote', txInput, () => {
          const invoice = db
            .prepare('SELECT * FROM invoices WHERE id = ?')
            .get(txInput.linkedInvoiceId) as DbInvoiceRow | undefined;
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

          if (txInput.type === 'Full') {
            const existingFullCredit = db
              .prepare(
                `SELECT COUNT(1) AS total
                 FROM credit_notes
                 WHERE linked_invoice_id = ? AND type = 'Full' AND status = 'Issued'`,
              )
              .get(txInput.linkedInvoiceId) as { total: number };
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
            if (txInput.lineItems && txInput.lineItems.length > 0) {
              lineItems = txInput.lineItems;
            } else if (txInput.adjustmentAmount && txInput.adjustmentAmount > 0) {
              lineItems = [
                {
                  description: 'Partial credit adjustment',
                  amount: txInput.adjustmentAmount,
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

          const id = randomUUID();
          const creditNoteNumber = allocateDocumentNumber('credit_note_sequences', 'CRN');
          const now = nowIso();
          try {
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
              txInput.linkedInvoiceId,
              invoice.customer_id,
              txInput.issueDate,
              txInput.reason,
              txInput.type,
              'Issued',
              totalCredit,
              JSON.stringify(lineItems),
              now,
              now,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              message.includes('credit_notes.credit_note_number') ||
              message.includes('uq_credit_notes_number')
            ) {
              throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
            }
            throw error;
          }

          assertNoInjectedFailure('create_credit_note_after_insert');
          upsertDocument(
            id,
            `${creditNoteNumber} ${txInput.reason}`,
            'custom',
            `${creditNoteNumber} ${txInput.reason} ${invoice.invoice_number ?? txInput.linkedInvoiceId}`,
          );
          timeline('credit_note.created', id, {
            creditNoteNumber,
            linkedInvoiceId: txInput.linkedInvoiceId,
            type: txInput.type,
            totalCredit,
          });

          const row = db
            .prepare('SELECT * FROM credit_notes WHERE id = ?')
            .get(id) as DbCreditNoteRow;
          return mapCreditNoteRow(row);
        }),
      )(input);
    },

    getCreditNoteById(id) {
      const row = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(id) as
        DbCreditNoteRow | undefined;
      return row ? mapCreditNoteRow(row) : null;
    },

    listCreditNotes(filter, options) {
      const rowFilter = filter ?? {};
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare(
          `SELECT * FROM credit_notes
           WHERE (? IS NULL OR customer_id = ?)
             AND (? IS NULL OR linked_invoice_id = ?)
           ORDER BY issue_date DESC, created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(
          rowFilter.customerId ?? null,
          rowFilter.customerId ?? null,
          rowFilter.linkedInvoiceId ?? null,
          rowFilter.linkedInvoiceId ?? null,
          limit,
          offset,
        ) as DbCreditNoteRow[];
      return rows.map(mapCreditNoteRow);
    },

    createCustomerPayment(input) {
      return db.transaction((txInput: CreateCustomerPaymentInput) =>
        withIdempotentCreate<CustomerPayment>('createCustomerPayment', txInput, () => {
          const customer = db
            .prepare('SELECT id FROM customers WHERE id = ?')
            .get(txInput.customerId);
          if (!customer) {
            throw new Error('Customer not found');
          }
          if (txInput.allocations.length === 0) {
            throw new Error('PAYMENT_ALLOCATIONS_REQUIRED');
          }

          const allocationInvoiceSet = new Set(
            txInput.allocations.map((allocation) => allocation.invoiceId),
          );
          if (allocationInvoiceSet.size !== txInput.allocations.length) {
            throw new Error('PAYMENT_DUPLICATE_ALLOCATION_INVOICE');
          }

          const allocationTotal = txInput.allocations.reduce(
            (sum, allocation) => sum + allocation.amount,
            0,
          );
          if (allocationTotal > txInput.amount) {
            throw new Error('PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT');
          }

          for (const allocation of txInput.allocations) {
            if (allocation.amount <= 0) {
              throw new Error('PAYMENT_ALLOCATION_AMOUNT_INVALID');
            }

            const invoice = db
              .prepare('SELECT * FROM invoices WHERE id = ?')
              .get(allocation.invoiceId) as DbInvoiceRow | undefined;
            if (!invoice) {
              throw new Error('Invoice not found');
            }
            if (invoice.status !== 'Finalised') {
              throw new Error('PAYMENT_ALLOCATION_REQUIRES_FINALISED_INVOICE');
            }
            if (invoice.customer_id !== txInput.customerId) {
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

          const id = randomUUID();
          const paymentNumber = allocateDocumentNumber('payment_sequences', 'PAY');
          const now = nowIso();

          try {
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
              txInput.customerId,
              txInput.paymentDate,
              txInput.paymentMethod,
              txInput.reference,
              txInput.amount,
              txInput.notes ?? null,
              now,
              now,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              message.includes('customer_payments.payment_number') ||
              message.includes('uq_customer_payments_number')
            ) {
              throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
            }
            throw error;
          }

          const insertAllocation = db.prepare(
            `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          );
          for (const allocation of txInput.allocations) {
            insertAllocation.run(randomUUID(), id, allocation.invoiceId, allocation.amount, now);
          }

          assertNoInjectedFailure('create_customer_payment_after_allocations');
          for (const allocation of txInput.allocations) {
            const invoice = db
              .prepare('SELECT * FROM invoices WHERE id = ?')
              .get(allocation.invoiceId) as DbInvoiceRow;
            const totalAllocated = db
              .prepare(
                `SELECT coalesce(sum(pa.amount), 0) AS total
                 FROM payment_allocations pa
                 WHERE pa.invoice_id = ?`,
              )
              .get(allocation.invoiceId) as { total: number };
            const nextState: PaymentState =
              totalAllocated.total >= invoice.total ? 'Paid' : 'Awaiting Payment';
            db.prepare('UPDATE invoices SET payment_state = ?, updated_at = ? WHERE id = ?').run(
              nextState,
              nowIso(),
              allocation.invoiceId,
            );
          }

          upsertDocument(
            id,
            `${paymentNumber} ${txInput.reference}`,
            'receipt',
            `${paymentNumber} ${txInput.paymentMethod} ${txInput.reference} ${txInput.notes ?? ''}`,
          );
          timeline('payment.created', id, {
            customerId: txInput.customerId,
            paymentNumber,
            amount: txInput.amount,
          });
          timeline('payment.allocated', id, {
            allocations: txInput.allocations,
            allocationTotal,
          });

          const paymentRow = db
            .prepare('SELECT * FROM customer_payments WHERE id = ?')
            .get(id) as DbCustomerPaymentRow;
          return mapCustomerPaymentRow(paymentRow, getAllocationsForPayment(id));
        }),
      )(input);
    },

    getCustomerPaymentById(id) {
      const row = db.prepare('SELECT * FROM customer_payments WHERE id = ?').get(id) as
        DbCustomerPaymentRow | undefined;
      if (!row) {
        return null;
      }
      return mapCustomerPaymentRow(row, getAllocationsForPayment(id));
    },

    listCustomerPayments(filter, options) {
      const rowFilter = filter ?? {};
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
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
           ORDER BY cp.payment_date DESC, cp.created_at DESC, cp.id DESC
           LIMIT ? OFFSET ?`,
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
          limit,
          offset,
        ) as DbCustomerPaymentRow[];
      const allocationsByPaymentId = mapPaymentAllocationsByPaymentId(rows.map((row) => row.id));
      return rows.map((row) =>
        mapCustomerPaymentRow(row, allocationsByPaymentId.get(row.id) ?? []),
      );
    },

    createSupplierBillDraft(input) {
      return db.transaction((txInput: CreateSupplierBillDraftInput) => {
        const supplier = db
          .prepare('SELECT id FROM suppliers WHERE id = ?')
          .get(txInput.supplierId);
        if (!supplier) {
          throw new Error('Supplier not found');
        }

        const { totals, calculatedItems } = calculateTotals(txInput.lineItems);
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
            txInput.supplierId,
            null,
            null,
            txInput.billDate,
            txInput.dueDate,
            txInput.supplierReference ?? null,
            txInput.currency,
            txInput.notes ?? null,
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
            message.includes(
              'UNIQUE constraint failed: supplier_bills.supplier_id, supplier_bills.supplier_reference',
            )
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
          const inputLine = txInput.lineItems[index];
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

        assertNoInjectedFailure('create_supplier_bill_after_line_items');
        upsertDocument(
          id,
          `Draft Supplier Bill ${txInput.supplierReference ?? ''}`.trim(),
          'supplier_bill',
          `${txInput.currency} ${txInput.notes ?? ''} ${txInput.supplierReference ?? ''}`,
        );
        timeline('supplier_bill.created', id, {
          status: 'Draft',
          supplierId: txInput.supplierId,
          total: totals.total,
        });

        const row = db
          .prepare('SELECT * FROM supplier_bills WHERE id = ?')
          .get(id) as DbSupplierBillRow;
        return mapSupplierBillRow(row);
      })(input);
    },

    createSupplierBillDraftFromPurchaseOrder(purchaseOrderId, input) {
      return db.transaction(() => {
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

        const duplicateSourceLines = new Set(
          sourceLines.map((lineItem) => lineItem.purchaseOrderLineItemId),
        );
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
            sourceLine.quantity *
            purchaseOrderLine.unitPrice *
            (purchaseOrderLine.gstApplicable ? 1.1 : 1);
        }

        if (selectedSupplierBillLineItems.length === 0) {
          throw new Error('PURCHASE_ORDER_BILLING_LINES_REQUIRED');
        }
        if (selectedTotal > purchaseOrder.remainingUnbilledAmount + 1e-6) {
          throw new Error('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING');
        }

        const existingLinkedBillCount = db
          .prepare(
            'SELECT count(*) AS count FROM supplier_bills WHERE source_purchase_order_id = ?',
          )
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
          db.prepare(
            'UPDATE supplier_bills SET source_purchase_order_id = ?, updated_at = ? WHERE id = ?',
          ).run(purchaseOrderId, nowIso(), created.id);
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

        const billingSummaryAfter = getPurchaseOrderBillingSummary(
          purchaseOrder.id,
          purchaseOrder.totals.total,
        );
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
      })();
    },

    deleteSupplierBillDraft(id) {
      return db.transaction((billId: string) => {
        const existing = db
          .prepare('SELECT status FROM supplier_bills WHERE id = ?')
          .get(billId) as { status: SupplierBillStatus } | undefined;
        if (!existing) {
          throw new Error('Supplier bill not found');
        }
        const allocationCount = db
          .prepare(
            'SELECT count(*) AS count FROM supplier_payment_allocations WHERE supplier_bill_id = ?',
          )
          .get(billId) as { count: number };
        if (allocationCount.count > 0) {
          throw new Error('SUPPLIER_BILL_HAS_ALLOCATIONS');
        }
        if (existing.status !== 'Draft') {
          throw new Error('IMMUTABLE_FINALISED_SUPPLIER_BILL');
        }

        db.prepare('DELETE FROM supplier_bill_line_items WHERE supplier_bill_id = ?').run(billId);
        db.prepare('DELETE FROM documents WHERE entity_id = ? AND document_type = ?').run(
          billId,
          'supplier_bill',
        );
        db.prepare('DELETE FROM supplier_bills WHERE id = ?').run(billId);
      })(id);
    },

    updateSupplierBillDraft(id, input) {
      const existing = db
        .prepare(
          'SELECT status, supplier_id, source_purchase_order_id FROM supplier_bills WHERE id = ?',
        )
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
          const remainingLineAmount =
            sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
          const updatedLineAmount =
            lineItem.quantity * lineItem.unitPrice * (lineItem.gstApplicable ? 1.1 : 1);
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
        if (
          linkedPoSummaryExcludingBill.total + projectedLinkedTotal >
          linkedPurchaseOrder.totals.total + 1e-6
        ) {
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
          message.includes(
            'UNIQUE constraint failed: supplier_bills.supplier_id, supplier_bills.supplier_reference',
          )
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

      const row = db
        .prepare('SELECT * FROM supplier_bills WHERE id = ?')
        .get(id) as DbSupplierBillRow;
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
        .get(id) as DbSupplierBillRow | undefined;
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
      return db.transaction((billId: string) => {
        const bill = this.getSupplierBillById(billId);
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
            const sourceLine = sourcePurchaseOrderLineMap.get(
              lineItem.sourcePurchaseOrderLineItemId,
            );
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
              .get(bill.sourcePurchaseOrderId, billId, lineItem.sourcePurchaseOrderLineItemId) as {
              total_quantity: number;
              total_amount: number;
            };

            const remainingLineQuantity = sourceLine.quantity - otherBillsSummary.total_quantity;
            if (lineItem.quantity > remainingLineQuantity + 1e-9) {
              throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING');
            }

            const sourceLineUnitTotal = sourceLine.unitPrice * (sourceLine.gstApplicable ? 1.1 : 1);
            const remainingLineAmount =
              sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
            const lineAmount =
              lineItem.quantity * lineItem.unitPrice * (lineItem.gstApplicable ? 1.1 : 1);
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
            .get(bill.sourcePurchaseOrderId, billId) as { total: number };
          if (
            otherLinkedBillsTotal.total + projectedSupplierBillTotal >
            sourcePurchaseOrder.totals.total + 1e-6
          ) {
            throw new Error('SUPPLIER_BILL_FINALISE_SOURCE_PO_VALUE_EXCEEDS_REMAINING');
          }
        }

        const billNumber = allocateDocumentNumber('supplier_bill_sequences', 'BILL');
        const now = nowIso();
        upsertDocument(
          billId,
          `${billNumber} ${bill.supplierReference ?? ''}`.trim(),
          'supplier_bill',
          `${billNumber} ${bill.currency} ${bill.notes ?? ''}`,
        );
        try {
          db.prepare(
            `UPDATE supplier_bills
             SET status = 'Finalised', bill_number = ?, payment_state = 'Awaiting Payment', updated_at = ?
             WHERE id = ?`,
          ).run(billNumber, now, billId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message.includes('uq_supplier_bills_number_not_null') ||
            message.includes('UNIQUE constraint failed: supplier_bills.bill_number')
          ) {
            throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
          }
          throw error;
        }

        const finalised = this.getSupplierBillById(billId);
        if (!finalised) {
          throw new Error('Failed to load finalised supplier bill');
        }
        assertNoInjectedFailure('finalise_supplier_bill_after_update');
        timeline('supplier_bill.finalised', billId, {
          billNumber,
          total: finalised.totals.total,
          linkageType: finalised.sourcePurchaseOrderId ? 'purchase_order_linked' : 'standalone',
          sourcePurchaseOrderId: finalised.sourcePurchaseOrderId,
          sourcePurchaseOrderNumber: finalised.sourcePurchaseOrderNumber,
        });

        return mapSupplierBillRow(
          db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(billId) as DbSupplierBillRow,
        );
      })(id);
    },

    listSupplierBills(filter, options) {
      const rowFilter = filter ?? {};
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
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
           ORDER BY sb.bill_date DESC, sb.created_at DESC, sb.id DESC
           LIMIT ? OFFSET ?`,
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
          limit,
          offset,
        ) as DbSupplierBillRow[];
      return rows.map(mapSupplierBillRow);
    },

    createPurchaseOrderDraft(input) {
      return db.transaction((txInput: CreatePurchaseOrderDraftInput) =>
        withIdempotentCreate<PurchaseOrder>('createPurchaseOrderDraft', txInput, () => {
          const supplier = db
            .prepare('SELECT id FROM suppliers WHERE id = ?')
            .get(txInput.supplierId);
          if (!supplier) {
            throw new Error('Supplier not found');
          }

          const { totals, calculatedItems } = calculateTotals(txInput.lineItems);
          const id = randomUUID();
          const now = nowIso();
          const purchaseOrderNumber = allocateDocumentNumber('purchase_order_sequences', 'PO');
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
              txInput.supplierId,
              txInput.issueDate,
              txInput.expectedDeliveryDate ?? null,
              txInput.supplierReference ?? null,
              txInput.currency,
              txInput.notes ?? null,
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
              message.includes(
                'UNIQUE constraint failed: purchase_orders.supplier_id, purchase_orders.supplier_reference',
              )
            ) {
              throw new Error('PURCHASE_ORDER_REFERENCE_EXISTS');
            }
            if (
              message.includes('purchase_orders.purchase_order_number') ||
              message.includes('uq_purchase_orders_number')
            ) {
              throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
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

          assertNoInjectedFailure('create_purchase_order_after_line_items');
          upsertDocument(
            id,
            `${purchaseOrderNumber} ${txInput.supplierReference ?? ''}`.trim(),
            'purchase_order',
            `${purchaseOrderNumber} ${txInput.currency} ${txInput.notes ?? ''} ${txInput.supplierReference ?? ''}`,
          );
          timeline('purchase_order.created', id, {
            purchaseOrderNumber,
            supplierId: txInput.supplierId,
            total: totals.total,
          });

          const row = db
            .prepare('SELECT * FROM purchase_orders WHERE id = ?')
            .get(id) as DbPurchaseOrderRow;
          return withPurchaseOrderBillingSummary(mapPurchaseOrderRow(row));
        }),
      )(input);
    },

    deletePurchaseOrderDraft(id) {
      return db.transaction((purchaseOrderId: string) => {
        const existing = db
          .prepare('SELECT status FROM purchase_orders WHERE id = ?')
          .get(purchaseOrderId) as { status: PurchaseOrderStatus } | undefined;
        if (!existing) {
          throw new Error('Purchase order not found');
        }
        const linkedBillCount = db
          .prepare(
            'SELECT count(*) AS count FROM supplier_bills WHERE source_purchase_order_id = ?',
          )
          .get(purchaseOrderId) as { count: number };
        if (linkedBillCount.count > 0) {
          throw new Error('PURCHASE_ORDER_HAS_LINKED_SUPPLIER_BILLS');
        }
        if (existing.status !== 'Draft') {
          throw new Error('IMMUTABLE_APPROVED_PURCHASE_ORDER');
        }

        db.prepare('DELETE FROM purchase_order_line_items WHERE purchase_order_id = ?').run(
          purchaseOrderId,
        );
        db.prepare('DELETE FROM documents WHERE entity_id = ? AND document_type = ?').run(
          purchaseOrderId,
          'purchase_order',
        );
        db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(purchaseOrderId);
      })(id);
    },

    updatePurchaseOrderDraft(id, input) {
      return db.transaction((purchaseOrderId: string, txInput: UpdatePurchaseOrderDraftInput) => {
        const existing = db
          .prepare('SELECT status FROM purchase_orders WHERE id = ?')
          .get(purchaseOrderId) as { status: PurchaseOrderStatus } | undefined;
        if (!existing) {
          throw new Error('Purchase order not found');
        }
        if (existing.status !== 'Draft') {
          throw new Error('Only draft purchase orders can be edited');
        }

        const { totals, calculatedItems } = calculateTotals(txInput.lineItems);
        try {
          db.prepare(
            `UPDATE purchase_orders
             SET issue_date = ?, expected_delivery_date = ?, supplier_reference = ?, currency = ?, notes = ?, subtotal = ?, gst_total = ?, total = ?, updated_at = ?
             WHERE id = ?`,
          ).run(
            txInput.issueDate,
            txInput.expectedDeliveryDate ?? null,
            txInput.supplierReference ?? null,
            txInput.currency,
            txInput.notes ?? null,
            totals.subtotal,
            totals.gstTotal,
            totals.total,
            nowIso(),
            purchaseOrderId,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message.includes('uq_purchase_orders_supplier_reference_not_null') ||
            message.includes(
              'UNIQUE constraint failed: purchase_orders.supplier_id, purchase_orders.supplier_reference',
            )
          ) {
            throw new Error('PURCHASE_ORDER_REFERENCE_EXISTS');
          }
          throw error;
        }

        db.prepare('DELETE FROM purchase_order_line_items WHERE purchase_order_id = ?').run(
          purchaseOrderId,
        );
        const insertLine = db.prepare(
          `INSERT INTO purchase_order_line_items (
            id, purchase_order_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of calculatedItems) {
          insertLine.run(
            randomUUID(),
            purchaseOrderId,
            item.description,
            item.quantity,
            item.unitPrice,
            item.gstApplicable ? 1 : 0,
            item.lineSubtotal,
            item.lineGst,
            item.lineTotal,
          );
        }

        const row = db
          .prepare('SELECT * FROM purchase_orders WHERE id = ?')
          .get(purchaseOrderId) as DbPurchaseOrderRow;
        upsertDocument(
          purchaseOrderId,
          `${row.purchase_order_number} ${row.supplier_reference ?? ''}`.trim(),
          'purchase_order',
          `${row.purchase_order_number} ${row.currency} ${row.notes ?? ''} ${row.supplier_reference ?? ''}`,
        );
        return withPurchaseOrderBillingSummary(mapPurchaseOrderRow(row));
      })(id, input);
    },

    getPurchaseOrderById(id) {
      const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as
        DbPurchaseOrderRow | undefined;
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
      return db.transaction((purchaseOrderId: string) => {
        const order = this.getPurchaseOrderById(purchaseOrderId);
        if (!order) {
          throw new Error('Purchase order not found');
        }
        if (order.status === 'Approved') {
          throw new Error('PURCHASE_ORDER_ALREADY_APPROVED');
        }
        assertValidPurchaseOrderStatusTransitionOrThrow(order.status, 'Approved');
        db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(
          'Approved',
          nowIso(),
          purchaseOrderId,
        );
        timeline('purchase_order.approved', purchaseOrderId, {
          purchaseOrderNumber: order.purchaseOrderNumber,
        });
        return withPurchaseOrderBillingSummary(
          mapPurchaseOrderRow(
            db
              .prepare('SELECT * FROM purchase_orders WHERE id = ?')
              .get(purchaseOrderId) as DbPurchaseOrderRow,
          ),
        );
      })(id);
    },

    closePurchaseOrder(id, input) {
      return db.transaction((purchaseOrderId: string, closeInput?: ClosePurchaseOrderInput) => {
        const order = this.getPurchaseOrderById(purchaseOrderId);
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

        const closeReason = closeInput?.closeReason?.trim();
        const closedDate = closeInput?.closedDate;
        const closedBy = closeInput?.closedBy?.trim() || 'system';

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
        ).run(
          'Closed',
          closeReason ?? null,
          persistedClosedDate,
          closedBy,
          nowIso(),
          purchaseOrderId,
        );

        const closureType =
          order.billingStatus === 'fully_billed'
            ? 'fully_billed_closure'
            : order.billingStatus === 'partially_billed'
              ? 'partially_billed_closure'
              : 'unbilled_closure';
        timeline('purchase_order.closed', purchaseOrderId, {
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
          mapPurchaseOrderRow(
            db
              .prepare('SELECT * FROM purchase_orders WHERE id = ?')
              .get(purchaseOrderId) as DbPurchaseOrderRow,
          ),
        );
      })(id, input);
    },

    cancelPurchaseOrder(id) {
      return db.transaction((purchaseOrderId: string) => {
        const order = this.getPurchaseOrderById(purchaseOrderId);
        if (!order) {
          throw new Error('Purchase order not found');
        }
        assertValidPurchaseOrderStatusTransitionOrThrow(order.status, 'Cancelled');
        db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(
          'Cancelled',
          nowIso(),
          purchaseOrderId,
        );
        timeline('purchase_order.cancelled', purchaseOrderId, {
          purchaseOrderNumber: order.purchaseOrderNumber,
        });
        return withPurchaseOrderBillingSummary(
          mapPurchaseOrderRow(
            db
              .prepare('SELECT * FROM purchase_orders WHERE id = ?')
              .get(purchaseOrderId) as DbPurchaseOrderRow,
          ),
        );
      })(id);
    },

    listPurchaseOrders(filter, options) {
      const rowFilter = filter ?? {};
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare(
          `WITH po_with_billed AS (
             SELECT
               po.*,
               coalesce(sb.total_billed, 0) AS total_billed
             FROM purchase_orders po
             LEFT JOIN (
               SELECT source_purchase_order_id, coalesce(sum(total), 0) AS total_billed
               FROM supplier_bills
               GROUP BY source_purchase_order_id
             ) sb ON sb.source_purchase_order_id = po.id
           )
           SELECT *
           FROM po_with_billed
           WHERE (? IS NULL OR supplier_id = ?)
             AND (? IS NULL OR purchase_order_number = ?)
             AND (? IS NULL OR status = ?)
             AND (? IS NULL OR issue_date >= ?)
             AND (? IS NULL OR issue_date <= ?)
             AND (? IS NULL OR expected_delivery_date >= ?)
             AND (? IS NULL OR expected_delivery_date <= ?)
             AND (
               ? IS NULL
               OR CASE
                    WHEN total_billed <= 0 THEN 'unbilled'
                    WHEN total_billed < total THEN 'partially_billed'
                    ELSE 'fully_billed'
                  END = ?
             )
           ORDER BY issue_date DESC, created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
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
          rowFilter.billingStatus ?? null,
          rowFilter.billingStatus ?? null,
          limit,
          offset,
        ) as DbPurchaseOrderRow[];
      const billedByPurchaseOrderId = mapBilledAmountByPurchaseOrderId(rows.map((row) => row.id));
      return rows.map((row) => {
        const purchaseOrder = mapPurchaseOrderRow(row);
        const totalBilledAmount = billedByPurchaseOrderId.get(row.id) ?? 0;
        const remainingUnbilledAmount = Math.max(purchaseOrder.totals.total - totalBilledAmount, 0);
        let billingStatus: PurchaseOrderBillingStatus = 'unbilled';
        if (totalBilledAmount > 0 && remainingUnbilledAmount > 0) {
          billingStatus = 'partially_billed';
        } else if (totalBilledAmount > 0 && remainingUnbilledAmount <= 0) {
          billingStatus = 'fully_billed';
        }
        return {
          ...purchaseOrder,
          totalBilledAmount,
          remainingUnbilledAmount,
          billingStatus,
        };
      });
    },

    createSupplierPayment(input) {
      return db.transaction((txInput: CreateSupplierPaymentInput) =>
        withIdempotentCreate<SupplierBillPayment>('createSupplierPayment', txInput, () => {
          const supplier = db
            .prepare('SELECT id FROM suppliers WHERE id = ?')
            .get(txInput.supplierId);
          if (!supplier) {
            throw new Error('Supplier not found');
          }
          if (txInput.allocations.length === 0) {
            throw new Error('SUPPLIER_PAYMENT_ALLOCATIONS_REQUIRED');
          }

          const allocationBillSet = new Set(
            txInput.allocations.map((allocation) => allocation.supplierBillId),
          );
          if (allocationBillSet.size !== txInput.allocations.length) {
            throw new Error('SUPPLIER_PAYMENT_DUPLICATE_ALLOCATION_BILL');
          }

          const allocationTotal = txInput.allocations.reduce(
            (sum, allocation) => sum + allocation.amount,
            0,
          );
          if (allocationTotal > txInput.amount) {
            throw new Error('SUPPLIER_PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT');
          }

          for (const allocation of txInput.allocations) {
            if (allocation.amount <= 0) {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID');
            }

            const bill = db
              .prepare('SELECT * FROM supplier_bills WHERE id = ?')
              .get(allocation.supplierBillId) as DbSupplierBillRow | undefined;
            if (!bill) {
              throw new Error('Supplier bill not found');
            }
            if (bill.status !== 'Finalised') {
              throw new Error('SUPPLIER_PAYMENT_ALLOCATION_REQUIRES_FINALISED_BILL');
            }
            if (bill.supplier_id !== txInput.supplierId) {
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
                const sourceLine = sourcePurchaseOrderLineMap.get(
                  billLine.source_purchase_order_line_item_id,
                );
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
                  .get(
                    bill.source_purchase_order_id,
                    allocation.supplierBillId,
                    billLine.source_purchase_order_line_item_id,
                  ) as { total_quantity: number; total_amount: number };

                const remainingLineQuantity =
                  sourceLine.quantity - otherBillsSummary.total_quantity;
                if (billLine.quantity > remainingLineQuantity + 1e-9) {
                  throw new Error(
                    'SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING',
                  );
                }

                const sourceLineUnitTotal =
                  sourceLine.unitPrice * (sourceLine.gstApplicable ? 1.1 : 1);
                const remainingLineAmount =
                  sourceLine.quantity * sourceLineUnitTotal - otherBillsSummary.total_amount;
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

          const id = randomUUID();
          const paymentNumber = allocateDocumentNumber('supplier_payment_sequences', 'SPAY');
          const now = nowIso();

          try {
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
              txInput.supplierId,
              txInput.paymentDate,
              txInput.paymentMethod,
              txInput.reference,
              txInput.amount,
              txInput.notes ?? null,
              now,
              now,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              message.includes('supplier_payments.payment_number') ||
              message.includes('uq_supplier_payments_number')
            ) {
              throw new Error('DOCUMENT_NUMBER_SEQUENCE_CONFLICT');
            }
            throw error;
          }

          const insertAllocation = db.prepare(
            `INSERT INTO supplier_payment_allocations (id, supplier_payment_id, supplier_bill_id, amount, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          );
          for (const allocation of txInput.allocations) {
            insertAllocation.run(
              randomUUID(),
              id,
              allocation.supplierBillId,
              allocation.amount,
              now,
            );
          }

          assertNoInjectedFailure('create_supplier_payment_after_allocations');
          for (const allocation of txInput.allocations) {
            const bill = db
              .prepare('SELECT * FROM supplier_bills WHERE id = ?')
              .get(allocation.supplierBillId) as DbSupplierBillRow;
            const totalAllocated = db
              .prepare(
                `SELECT coalesce(sum(spa.amount), 0) AS total
                 FROM supplier_payment_allocations spa
                 WHERE spa.supplier_bill_id = ?`,
              )
              .get(allocation.supplierBillId) as { total: number };
            const nextState: PaymentState =
              totalAllocated.total >= bill.total ? 'Paid' : 'Awaiting Payment';
            db.prepare(
              'UPDATE supplier_bills SET payment_state = ?, updated_at = ? WHERE id = ?',
            ).run(nextState, nowIso(), allocation.supplierBillId);
          }

          upsertDocument(
            id,
            `${paymentNumber} ${txInput.reference}`,
            'receipt',
            `${paymentNumber} ${txInput.paymentMethod} ${txInput.reference} ${txInput.notes ?? ''}`,
          );
          timeline('supplier_payment.created', id, {
            supplierId: txInput.supplierId,
            paymentNumber,
            amount: txInput.amount,
          });
          timeline('supplier_payment.allocated', id, {
            allocations: txInput.allocations,
            allocationTotal,
          });

          const paymentRow = db
            .prepare('SELECT * FROM supplier_payments WHERE id = ?')
            .get(id) as DbSupplierPaymentRow;
          return mapSupplierPaymentRow(paymentRow, getAllocationsForSupplierPayment(id));
        }),
      )(input);
    },

    getSupplierPaymentById(id) {
      const row = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as
        DbSupplierPaymentRow | undefined;
      if (!row) {
        return null;
      }
      return mapSupplierPaymentRow(row, getAllocationsForSupplierPayment(id));
    },

    listSupplierPayments(filter, options) {
      const rowFilter = filter ?? {};
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
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
           ORDER BY sp.payment_date DESC, sp.created_at DESC, sp.id DESC
           LIMIT ? OFFSET ?`,
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
          limit,
          offset,
        ) as DbSupplierPaymentRow[];
      const allocationsByPaymentId = mapSupplierPaymentAllocationsByPaymentId(
        rows.map((row) => row.id),
      );
      return rows.map((row) =>
        mapSupplierPaymentRow(row, allocationsByPaymentId.get(row.id) ?? []),
      );
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

    deleteRole(id) {
      return db.transaction((roleId: string) => {
        const existing = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
        if (!existing) {
          throw new Error('ROLE_NOT_FOUND');
        }
        const linkCount = db
          .prepare('SELECT count(*) AS count FROM user_role_links WHERE role_id = ?')
          .get(roleId) as { count: number };
        if (linkCount.count > 0) {
          throw new Error('ROLE_HAS_USERS');
        }
        db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
      })(id);
    },

    getRoleById(id) {
      const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as DbRoleRow | undefined;
      return row ? mapRoleRow(row) : null;
    },

    listRoles(options) {
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM roles ORDER BY name ASC, id ASC LIMIT ? OFFSET ?')
        .all(limit, offset) as DbRoleRow[];
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

    deleteUser(id) {
      return db.transaction((userId: string) => {
        const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
        if (!existing) {
          throw new Error('USER_NOT_FOUND');
        }

        const assignedJobCount = db
          .prepare('SELECT count(*) AS count FROM jobs WHERE assigned_user_id = ?')
          .get(userId) as { count: number };
        if (assignedJobCount.count > 0) {
          throw new Error('USER_HAS_ASSIGNED_JOBS');
        }

        const teamMembershipCount = db
          .prepare('SELECT count(*) AS count FROM team_memberships WHERE user_id = ?')
          .get(userId) as { count: number };
        if (teamMembershipCount.count > 0) {
          throw new Error('USER_HAS_TEAM_MEMBERSHIPS');
        }

        db.prepare('DELETE FROM user_role_links WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      })(id);
    },

    getUserById(id) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow | undefined;
      return row ? mapUserRow(row, getRoleIdsForUser(id)) : null;
    },

    listUsers(options) {
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as DbUserRow[];
      const roleIdsByUser = getRoleIdsForUsers(rows.map((row) => row.id));
      return rows.map((row) => mapUserRow(row, roleIdsByUser.get(row.id) ?? []));
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

    listTeams(options) {
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM teams ORDER BY name ASC, id ASC LIMIT ? OFFSET ?')
        .all(limit, offset) as DbTeamRow[];
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
        assertAuthorizedForTeamActionOrThrow(
          teamId,
          actorUserId,
          'add_member',
          null,
          requestedRole,
        );
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
        if (
          message.includes(
            'UNIQUE constraint failed: team_memberships.team_id, team_memberships.user_id',
          )
        ) {
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
      assertAuthorizedForTeamActionOrThrow(
        teamId,
        actorUserId,
        'change_member_role',
        currentRole,
        role,
      );

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

    listTeamMembers(teamId, options) {
      ensureTeamExistsOrThrow(teamId);
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
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
           ORDER BY tm.created_at ASC, tm.id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(teamId, limit, offset) as Array<{
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
      const roleIdsByUser = getRoleIdsForUsers(rows.map((row) => row.user_id_ref));

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
          roleIdsByUser.get(row.user_id_ref) ?? [],
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
        { prefix: string; year: number; next_sequence: number } | undefined;
      let prefix = 'JOB';
      let sequence = 1;

      if (!sequenceRow) {
        db.prepare(
          'INSERT INTO job_sequences (id, prefix, year, next_sequence) VALUES (1, ?, ?, ?)',
        ).run(prefix, currentYear, 2);
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

      upsertDocument(
        id,
        input.title,
        'custom',
        `${jobNumber} ${input.title} ${input.description ?? ''}`,
      );
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
      const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
        DbJobRow | undefined;
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

      upsertDocument(
        id,
        input.title,
        'custom',
        `${existing.job_number} ${input.title} ${input.description ?? ''}`,
      );
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

    listJobs(options) {
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;
      const rows = db
        .prepare('SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as DbJobRow[];
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

    listJobDocuments(jobId, options) {
      const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      const pagination = options ?? {};
      const limit = pagination.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = pagination.offset ?? 0;

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
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(jobId, limit, offset) as Array<{
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
           ORDER BY issue_date ASC, created_at ASC, id ASC`,
        )
        .all(customerId, from, from, to, to) as CustomerStatementEntry[];

      const periodTotal = entries.reduce((sum, entry) => sum + entry.total, 0);
      const closingBalance = openingBalance + periodTotal;
      const generatedAtRow = db
        .prepare(
          `SELECT max(ts) AS ts
           FROM (
             SELECT ? AS ts
             UNION ALL
             SELECT max(updated_at) AS ts
             FROM invoices
             WHERE customer_id = ? AND status = 'Finalised'
           )`,
        )
        .get(customer.updatedAt, customerId) as { ts: string | null };

      return {
        customer,
        generatedAt: generatedAtRow.ts ?? customer.updatedAt,
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

    getReportingReadModel(options) {
      const query = options ?? {};
      const from = query.from ?? null;
      const to = query.to ?? null;
      const limit = query.limit ?? 25;
      const offset = query.offset ?? 0;

      const totalsById = (rows: Array<{ id: string; amount: number }>): Map<string, number> =>
        new Map(rows.map((row) => [row.id, Number(row.amount ?? 0)]));

      const invoiceRows = db
        .prepare(
          `SELECT *
           FROM invoices
           WHERE status = 'Finalised'
             AND (? IS NULL OR issue_date >= ?)
             AND (? IS NULL OR issue_date <= ?)
           ORDER BY issue_date ASC, created_at ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(from, from, to, to, limit, offset) as DbInvoiceRow[];
      const invoiceIds = invoiceRows.map((row) => row.id);

      let invoiceCreditsById = new Map<string, number>();
      let invoicePaymentsById = new Map<string, number>();
      if (invoiceIds.length > 0) {
        const placeholders = invoiceIds.map(() => '?').join(',');
        invoiceCreditsById = totalsById(
          db
            .prepare(
              `SELECT linked_invoice_id AS id, coalesce(sum(total_credit), 0) AS amount
               FROM credit_notes
               WHERE linked_invoice_id IN (${placeholders})
               GROUP BY linked_invoice_id`,
            )
            .all(...invoiceIds) as Array<{ id: string; amount: number }>,
        );
        invoicePaymentsById = totalsById(
          db
            .prepare(
              `SELECT pa.invoice_id AS id, coalesce(sum(pa.amount), 0) AS amount
               FROM payment_allocations pa
               WHERE pa.invoice_id IN (${placeholders})
               GROUP BY pa.invoice_id`,
            )
            .all(...invoiceIds) as Array<{ id: string; amount: number }>,
        );
      }

      const invoices = invoiceRows.map((invoiceRow) => {
        const totalCredited = invoiceCreditsById.get(invoiceRow.id) ?? 0;
        const totalPaid = invoicePaymentsById.get(invoiceRow.id) ?? 0;
        const outstanding = invoiceRow.total - totalCredited - totalPaid;
        return {
          invoiceId: invoiceRow.id,
          invoiceNumber: invoiceRow.invoice_number ?? invoiceRow.id,
          customerId: invoiceRow.customer_id,
          issueDate: invoiceRow.issue_date,
          totalInvoiced: invoiceRow.total,
          totalCredited,
          totalPaid,
          outstanding,
        };
      });
      const arTotalInvoiced = (
        db
          .prepare(
            `SELECT coalesce(sum(total), 0) AS amount
             FROM invoices
             WHERE status = 'Finalised'
               AND (? IS NULL OR issue_date >= ?)
               AND (? IS NULL OR issue_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const arTotalCredited = (
        db
          .prepare(
            `SELECT coalesce(sum(cn.total_credit), 0) AS amount
             FROM credit_notes cn
             INNER JOIN invoices i ON i.id = cn.linked_invoice_id
             WHERE i.status = 'Finalised'
               AND (? IS NULL OR i.issue_date >= ?)
               AND (? IS NULL OR i.issue_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const arTotalPaid = (
        db
          .prepare(
            `SELECT coalesce(sum(pa.amount), 0) AS amount
             FROM payment_allocations pa
             INNER JOIN invoices i ON i.id = pa.invoice_id
             WHERE i.status = 'Finalised'
               AND (? IS NULL OR i.issue_date >= ?)
               AND (? IS NULL OR i.issue_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;

      const customers = db
        .prepare(
          `SELECT id, display_name
           FROM customers
           ORDER BY display_name ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as Array<{ id: string; display_name: string }>;
      const pagedCustomers = customers;
      const pagedCustomerIds = pagedCustomers.map((row) => row.id);

      const sumByCustomerId = (
        rows: Array<{ customer_id: string; amount: number }>,
      ): Map<string, number> =>
        new Map(rows.map((row) => [row.customer_id, Number(row.amount ?? 0)]));

      let openingInvoicesByCustomer = new Map<string, number>();
      let openingCreditsByCustomer = new Map<string, number>();
      let openingPaymentsByCustomer = new Map<string, number>();
      let activityInvoicesByCustomer = new Map<string, number>();
      let activityCreditsByCustomer = new Map<string, number>();
      let activityPaymentsByCustomer = new Map<string, number>();

      if (pagedCustomerIds.length > 0) {
        const placeholders = pagedCustomerIds.map(() => '?').join(',');
        if (from) {
          openingInvoicesByCustomer = sumByCustomerId(
            db
              .prepare(
                `SELECT customer_id, coalesce(sum(total), 0) AS amount
                 FROM invoices
                 WHERE customer_id IN (${placeholders})
                   AND status = 'Finalised'
                   AND issue_date < ?
                 GROUP BY customer_id`,
              )
              .all(...pagedCustomerIds, from) as Array<{ customer_id: string; amount: number }>,
          );
          openingCreditsByCustomer = sumByCustomerId(
            db
              .prepare(
                `SELECT i.customer_id AS customer_id, coalesce(sum(cn.total_credit), 0) AS amount
                 FROM credit_notes cn
                 INNER JOIN invoices i ON i.id = cn.linked_invoice_id
                 WHERE i.customer_id IN (${placeholders})
                   AND cn.issue_date < ?
                 GROUP BY i.customer_id`,
              )
              .all(...pagedCustomerIds, from) as Array<{ customer_id: string; amount: number }>,
          );
          openingPaymentsByCustomer = sumByCustomerId(
            db
              .prepare(
                `SELECT customer_id, coalesce(sum(amount), 0) AS amount
                 FROM customer_payments
                 WHERE customer_id IN (${placeholders})
                   AND payment_date < ?
                 GROUP BY customer_id`,
              )
              .all(...pagedCustomerIds, from) as Array<{ customer_id: string; amount: number }>,
          );
        }
        activityInvoicesByCustomer = sumByCustomerId(
          db
            .prepare(
              `SELECT customer_id, coalesce(sum(total), 0) AS amount
               FROM invoices
               WHERE customer_id IN (${placeholders})
                 AND status = 'Finalised'
                 AND (? IS NULL OR issue_date >= ?)
                 AND (? IS NULL OR issue_date <= ?)
               GROUP BY customer_id`,
            )
            .all(...pagedCustomerIds, from, from, to, to) as Array<{
            customer_id: string;
            amount: number;
          }>,
        );
        activityCreditsByCustomer = sumByCustomerId(
          db
            .prepare(
              `SELECT i.customer_id AS customer_id, coalesce(sum(cn.total_credit), 0) AS amount
               FROM credit_notes cn
               INNER JOIN invoices i ON i.id = cn.linked_invoice_id
               WHERE i.customer_id IN (${placeholders})
                 AND (? IS NULL OR cn.issue_date >= ?)
                 AND (? IS NULL OR cn.issue_date <= ?)
               GROUP BY i.customer_id`,
            )
            .all(...pagedCustomerIds, from, from, to, to) as Array<{
            customer_id: string;
            amount: number;
          }>,
        );
        activityPaymentsByCustomer = sumByCustomerId(
          db
            .prepare(
              `SELECT customer_id, coalesce(sum(amount), 0) AS amount
               FROM customer_payments
               WHERE customer_id IN (${placeholders})
                 AND (? IS NULL OR payment_date >= ?)
                 AND (? IS NULL OR payment_date <= ?)
               GROUP BY customer_id`,
            )
            .all(...pagedCustomerIds, from, from, to, to) as Array<{
            customer_id: string;
            amount: number;
          }>,
        );
      }

      const customerStatements = pagedCustomers.map((customerRow) => {
        const openingInvoices = openingInvoicesByCustomer.get(customerRow.id) ?? 0;
        const openingCredits = openingCreditsByCustomer.get(customerRow.id) ?? 0;
        const openingPayments = openingPaymentsByCustomer.get(customerRow.id) ?? 0;
        const activityInvoices = activityInvoicesByCustomer.get(customerRow.id) ?? 0;
        const activityCredits = activityCreditsByCustomer.get(customerRow.id) ?? 0;
        const activityPayments = activityPaymentsByCustomer.get(customerRow.id) ?? 0;

        const openingBalance = openingInvoices - openingCredits - openingPayments;
        const activity = activityInvoices - activityCredits - activityPayments;
        const closingBalance = openingBalance + activity;
        return {
          customerId: customerRow.id,
          customerName: customerRow.display_name,
          openingBalance,
          activity,
          closingBalance,
        };
      });

      const purchaseOrderRows = db
        .prepare(
          `SELECT *
           FROM purchase_orders
           WHERE (? IS NULL OR issue_date >= ?)
             AND (? IS NULL OR issue_date <= ?)
           ORDER BY issue_date ASC, created_at ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(from, from, to, to, limit, offset) as DbPurchaseOrderRow[];
      const purchaseOrderIds = purchaseOrderRows.map((row) => row.id);
      let billedByPurchaseOrder = new Map<string, number>();
      if (purchaseOrderIds.length > 0) {
        const placeholders = purchaseOrderIds.map(() => '?').join(',');
        billedByPurchaseOrder = totalsById(
          db
            .prepare(
              `SELECT source_purchase_order_id AS id, coalesce(sum(total), 0) AS amount
               FROM supplier_bills
               WHERE source_purchase_order_id IN (${placeholders})
               GROUP BY source_purchase_order_id`,
            )
            .all(...purchaseOrderIds) as Array<{ id: string; amount: number }>,
        );
      }
      const purchaseOrders = purchaseOrderRows.map((purchaseOrderRow) => {
        const totalBilled = billedByPurchaseOrder.get(purchaseOrderRow.id) ?? 0;
        const remainingValue = purchaseOrderRow.total - totalBilled;
        return {
          purchaseOrderId: purchaseOrderRow.id,
          purchaseOrderNumber: purchaseOrderRow.purchase_order_number,
          supplierId: purchaseOrderRow.supplier_id,
          issueDate: purchaseOrderRow.issue_date,
          totalOrdered: purchaseOrderRow.total,
          totalBilled,
          remainingValue,
        };
      });

      const supplierBillRows = db
        .prepare(
          `SELECT *
           FROM supplier_bills
           WHERE (? IS NULL OR bill_date >= ?)
             AND (? IS NULL OR bill_date <= ?)
           ORDER BY bill_date ASC, created_at ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(from, from, to, to, limit, offset) as DbSupplierBillRow[];
      const supplierBillIds = supplierBillRows.map((row) => row.id);
      let paymentsBySupplierBill = new Map<string, number>();
      if (supplierBillIds.length > 0) {
        const placeholders = supplierBillIds.map(() => '?').join(',');
        paymentsBySupplierBill = totalsById(
          db
            .prepare(
              `SELECT supplier_bill_id AS id, coalesce(sum(amount), 0) AS amount
               FROM supplier_payment_allocations
               WHERE supplier_bill_id IN (${placeholders})
               GROUP BY supplier_bill_id`,
            )
            .all(...supplierBillIds) as Array<{ id: string; amount: number }>,
        );
      }
      const supplierBills = supplierBillRows.map((supplierBillRow) => {
        const totalPaid = paymentsBySupplierBill.get(supplierBillRow.id) ?? 0;
        const outstanding = supplierBillRow.total - totalPaid;
        return {
          supplierBillId: supplierBillRow.id,
          supplierId: supplierBillRow.supplier_id,
          billNumber: supplierBillRow.bill_number,
          billDate: supplierBillRow.bill_date,
          status: supplierBillRow.status,
          totalBilled: supplierBillRow.total,
          totalPaid,
          outstanding,
        };
      });

      const apTotalOrdered = (
        db
          .prepare(
            `SELECT coalesce(sum(total), 0) AS amount
             FROM purchase_orders
             WHERE (? IS NULL OR issue_date >= ?)
               AND (? IS NULL OR issue_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const apTotalBilled = (
        db
          .prepare(
            `SELECT coalesce(sum(total), 0) AS amount
             FROM supplier_bills
             WHERE (? IS NULL OR bill_date >= ?)
               AND (? IS NULL OR bill_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const apTotalPaid = (
        db
          .prepare(
            `SELECT coalesce(sum(spa.amount), 0) AS amount
           FROM supplier_payment_allocations spa
           INNER JOIN supplier_payments sp ON sp.id = spa.supplier_payment_id
           WHERE (? IS NULL OR sp.payment_date >= ?)
             AND (? IS NULL OR sp.payment_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const apRemainingOrderedValue = (
        db
          .prepare(
            `SELECT coalesce(sum(po.total - coalesce(sb.total_billed, 0)), 0) AS amount
             FROM purchase_orders po
             LEFT JOIN (
               SELECT source_purchase_order_id, coalesce(sum(total), 0) AS total_billed
               FROM supplier_bills
               GROUP BY source_purchase_order_id
             ) sb ON sb.source_purchase_order_id = po.id
             WHERE (? IS NULL OR po.issue_date >= ?)
               AND (? IS NULL OR po.issue_date <= ?)`,
          )
          .get(from, from, to, to) as { amount: number }
      ).amount;
      const generatedAtRow = db
        .prepare(
          `SELECT max(ts) AS ts
           FROM (
             SELECT max(updated_at) AS ts FROM customers
             UNION ALL SELECT max(updated_at) AS ts FROM suppliers
             UNION ALL SELECT max(updated_at) AS ts FROM invoices
             UNION ALL SELECT max(updated_at) AS ts FROM credit_notes
             UNION ALL SELECT max(updated_at) AS ts FROM customer_payments
             UNION ALL SELECT max(updated_at) AS ts FROM purchase_orders
             UNION ALL SELECT max(updated_at) AS ts FROM supplier_bills
             UNION ALL SELECT max(updated_at) AS ts FROM supplier_payments
           )`,
        )
        .get() as { ts: string | null };

      return {
        generatedAt: generatedAtRow.ts ?? nowIso(),
        filters: { from, to, limit, offset },
        accountsReceivable: {
          totals: {
            totalInvoiced: arTotalInvoiced,
            totalCredited: arTotalCredited,
            totalPaid: arTotalPaid,
            outstanding: arTotalInvoiced - arTotalCredited - arTotalPaid,
          },
          invoices,
          customerStatements,
        },
        accountsPayable: {
          totals: {
            totalOrdered: apTotalOrdered,
            totalBilled: apTotalBilled,
            totalPaid: Number(apTotalPaid ?? 0),
            remainingOrderedValue: apRemainingOrderedValue,
            supplierBillOutstanding: apTotalBilled - Number(apTotalPaid ?? 0),
          },
          purchaseOrders,
          supplierBills,
        },
      };
    },

    getTimelineForEntity(entityType, entityId, options) {
      const queryOptions = options ?? {};
      const whereClauses = ['entity_type = ?', 'entity_id = ?'];
      const params: Array<string | number> = [entityType, entityId];
      if (queryOptions.eventKey) {
        whereClauses.push('coalesce(event_key, event_type) = ?');
        params.push(queryOptions.eventKey);
      }

      let sql = `SELECT
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
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY created_at ASC, rowid ASC`;
      if (typeof queryOptions.limit === 'number') {
        sql += ' LIMIT ?';
        params.push(queryOptions.limit);
      }
      if (typeof queryOptions.offset === 'number') {
        sql += ' OFFSET ?';
        params.push(queryOptions.offset);
      }

      return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    },

    search(query, options) {
      const wildcard = `%${query.toLowerCase()}%`;
      const limit = options?.limit ?? 25;
      const offset = options?.offset ?? 0;
      const requestedEntityTypes = new Set<SearchEntityType>(
        options?.entityTypes ?? [
          'customers',
          'suppliers',
          'invoices',
          'creditNotes',
          'customerPayments',
          'purchaseOrders',
          'supplierBills',
          'supplierPayments',
          'documents',
          'jobs',
        ],
      );

      const customers = requestedEntityTypes.has('customers')
        ? db
            .prepare(
              `SELECT * FROM customers
               WHERE lower(display_name) LIKE ?
                  OR lower(coalesce(email, '')) LIKE ?
                  OR lower(coalesce(notes, '')) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, limit, offset)
            .map((row: unknown) => mapCustomerRow(row as Record<string, unknown>))
        : [];

      const suppliers = requestedEntityTypes.has('suppliers')
        ? db
            .prepare(
              `SELECT * FROM suppliers
               WHERE lower(display_name) LIKE ?
                  OR lower(coalesce(email, '')) LIKE ?
                  OR lower(coalesce(notes, '')) LIKE ?
                  OR lower(coalesce(tax_id, '')) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, wildcard, limit, offset)
            .map((row: unknown) => mapSupplierRow(row as DbSupplierRow))
        : [];

      const invoiceRows = requestedEntityTypes.has('invoices')
        ? (db
            .prepare(
              `SELECT * FROM invoices
               WHERE lower(title) LIKE ? OR lower(coalesce(invoice_number, '')) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, limit, offset) as DbInvoiceRow[])
        : [];
      const invoiceCreditNoteIds = new Map<string, string[]>();
      const invoiceCustomerPaymentIds = new Map<string, string[]>();
      if (invoiceRows.length > 0) {
        const placeholders = invoiceRows.map(() => '?').join(',');
        const invoiceIds = invoiceRows.map((row) => row.id);
        const creditNoteRows = db
          .prepare(
            `SELECT linked_invoice_id AS invoice_id, id
             FROM credit_notes
             WHERE linked_invoice_id IN (${placeholders})
             ORDER BY linked_invoice_id ASC, created_at ASC, id ASC`,
          )
          .all(...invoiceIds) as Array<{ invoice_id: string; id: string }>;
        for (const creditNoteRow of creditNoteRows) {
          const existing = invoiceCreditNoteIds.get(creditNoteRow.invoice_id) ?? [];
          existing.push(creditNoteRow.id);
          invoiceCreditNoteIds.set(creditNoteRow.invoice_id, existing);
        }

        const paymentRows = db
          .prepare(
            `SELECT pa.invoice_id AS invoice_id, p.id AS payment_id
             FROM payment_allocations pa
             INNER JOIN customer_payments p ON p.id = pa.payment_id
             WHERE pa.invoice_id IN (${placeholders})
             ORDER BY pa.invoice_id ASC, p.created_at ASC, p.id ASC`,
          )
          .all(...invoiceIds) as Array<{ invoice_id: string; payment_id: string }>;
        for (const paymentRow of paymentRows) {
          const existing = invoiceCustomerPaymentIds.get(paymentRow.invoice_id) ?? [];
          if (!existing.includes(paymentRow.payment_id)) {
            existing.push(paymentRow.payment_id);
            invoiceCustomerPaymentIds.set(paymentRow.invoice_id, existing);
          }
        }
      }
      const invoices = invoiceRows.map((row) => {
        return {
          ...mapInvoiceRow(row),
          creditNoteIds: invoiceCreditNoteIds.get(row.id) ?? [],
          customerPaymentIds: invoiceCustomerPaymentIds.get(row.id) ?? [],
        };
      });

      const creditNotes = requestedEntityTypes.has('creditNotes')
        ? (
            db
              .prepare(
                `SELECT *
               FROM credit_notes
               WHERE lower(reason) LIKE ?
                  OR lower(credit_note_number) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
              )
              .all(wildcard, wildcard, limit, offset) as DbCreditNoteRow[]
          ).map(mapCreditNoteRow)
        : [];

      const customerPayments = requestedEntityTypes.has('customerPayments')
        ? (db
            .prepare(
              `SELECT *
               FROM customer_payments
               WHERE lower(payment_number) LIKE ?
                  OR lower(reference) LIKE ?
                  OR lower(payment_method) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, limit, offset) as DbCustomerPaymentRow[])
        : [];
      const customerPaymentAllocationsByPaymentId = mapPaymentAllocationsByPaymentId(
        customerPayments.map((row) => row.id),
      );
      const mappedCustomerPayments = customerPayments.map((row) =>
        mapCustomerPaymentRow(row, customerPaymentAllocationsByPaymentId.get(row.id) ?? []),
      );

      const purchaseOrderRows = requestedEntityTypes.has('purchaseOrders')
        ? (db
            .prepare(
              `SELECT *
               FROM purchase_orders
               WHERE lower(purchase_order_number) LIKE ?
                  OR lower(coalesce(supplier_reference, '')) LIKE ?
                  OR lower(coalesce(notes, '')) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, limit, offset) as DbPurchaseOrderRow[])
        : [];
      const purchaseOrderBilledById = mapBilledAmountByPurchaseOrderId(
        purchaseOrderRows.map((row) => row.id),
      );
      const purchaseOrderSupplierBillIds = new Map<string, string[]>();
      if (purchaseOrderRows.length > 0) {
        const placeholders = purchaseOrderRows.map(() => '?').join(',');
        const purchaseOrderIds = purchaseOrderRows.map((row) => row.id);
        const supplierBillRows = db
          .prepare(
            `SELECT source_purchase_order_id AS purchase_order_id, id
             FROM supplier_bills
             WHERE source_purchase_order_id IN (${placeholders})
             ORDER BY source_purchase_order_id ASC, created_at ASC, id ASC`,
          )
          .all(...purchaseOrderIds) as Array<{ purchase_order_id: string; id: string }>;
        for (const supplierBillRow of supplierBillRows) {
          const existing =
            purchaseOrderSupplierBillIds.get(supplierBillRow.purchase_order_id) ?? [];
          existing.push(supplierBillRow.id);
          purchaseOrderSupplierBillIds.set(supplierBillRow.purchase_order_id, existing);
        }
      }
      const purchaseOrders = purchaseOrderRows.map((row) => {
        const purchaseOrder = mapPurchaseOrderRow(row);
        const totalBilledAmount = purchaseOrderBilledById.get(row.id) ?? 0;
        const remainingUnbilledAmount = Math.max(purchaseOrder.totals.total - totalBilledAmount, 0);
        let billingStatus: PurchaseOrderBillingStatus = 'unbilled';
        if (totalBilledAmount > 0 && remainingUnbilledAmount > 0) {
          billingStatus = 'partially_billed';
        } else if (totalBilledAmount > 0 && remainingUnbilledAmount <= 0) {
          billingStatus = 'fully_billed';
        }
        return {
          ...purchaseOrder,
          totalBilledAmount,
          remainingUnbilledAmount,
          billingStatus,
          supplierBillIds: purchaseOrderSupplierBillIds.get(row.id) ?? [],
        };
      });

      const supplierBills = requestedEntityTypes.has('supplierBills')
        ? (
            db
              .prepare(
                `SELECT sb.*, po.purchase_order_number AS source_purchase_order_number
               FROM supplier_bills sb
               LEFT JOIN purchase_orders po ON po.id = sb.source_purchase_order_id
               WHERE lower(coalesce(sb.bill_number, '')) LIKE ?
                  OR lower(coalesce(sb.supplier_reference, '')) LIKE ?
                  OR lower(coalesce(sb.notes, '')) LIKE ?
               ORDER BY sb.updated_at DESC, sb.id DESC
               LIMIT ? OFFSET ?`,
              )
              .all(wildcard, wildcard, wildcard, limit, offset) as DbSupplierBillRow[]
          ).map(mapSupplierBillRow)
        : [];

      const supplierPayments = requestedEntityTypes.has('supplierPayments')
        ? (db
            .prepare(
              `SELECT *
               FROM supplier_payments
               WHERE lower(payment_number) LIKE ?
                  OR lower(reference) LIKE ?
                  OR lower(payment_method) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, limit, offset) as DbSupplierPaymentRow[])
        : [];
      const supplierPaymentAllocationsByPaymentId = mapSupplierPaymentAllocationsByPaymentId(
        supplierPayments.map((row) => row.id),
      );
      const mappedSupplierPayments = supplierPayments.map((row) =>
        mapSupplierPaymentRow(row, supplierPaymentAllocationsByPaymentId.get(row.id) ?? []),
      );

      const documents = requestedEntityTypes.has('documents')
        ? (db
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
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, limit, offset) as DocumentRecord[])
        : [];

      const jobs = requestedEntityTypes.has('jobs')
        ? db
            .prepare(
              `SELECT * FROM jobs
               WHERE lower(title) LIKE ?
                 OR lower(job_number) LIKE ?
                 OR lower(coalesce(description, '')) LIKE ?
                 OR lower(coalesce(assigned_user_name, '')) LIKE ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ? OFFSET ?`,
            )
            .all(wildcard, wildcard, wildcard, wildcard, limit, offset)
            .map((row: unknown) => mapJobRow(row as DbJobRow))
        : [];

      return {
        customers,
        suppliers,
        invoices,
        creditNotes,
        customerPayments: mappedCustomerPayments,
        purchaseOrders,
        supplierBills,
        supplierPayments: mappedSupplierPayments,
        documents,
        jobs,
      };
    },

    exportPlatformSnapshot() {
      const customerRows = db.prepare('SELECT * FROM customers ORDER BY id ASC').all() as Array<
        Record<string, unknown>
      >;
      const finalisedInvoiceRows = db
        .prepare(
          `SELECT
             customer_id,
             id AS invoice_id,
             coalesce(invoice_number, id) AS invoice_number,
             issue_date,
             due_date,
             title,
             total,
             updated_at
           FROM invoices
           WHERE status = 'Finalised'
           ORDER BY customer_id ASC, issue_date ASC, created_at ASC, id ASC`,
        )
        .all() as Array<{
        customer_id: string;
        invoice_id: string;
        invoice_number: string;
        issue_date: string;
        due_date: string;
        title: string;
        total: number;
        updated_at: string;
      }>;
      const entriesByCustomerId = new Map<string, CustomerStatementEntry[]>();
      const latestInvoiceUpdatedAtByCustomerId = new Map<string, string>();
      for (const invoiceRow of finalisedInvoiceRows) {
        const existingEntries = entriesByCustomerId.get(invoiceRow.customer_id) ?? [];
        existingEntries.push({
          invoiceId: invoiceRow.invoice_id,
          invoiceNumber: invoiceRow.invoice_number,
          issueDate: invoiceRow.issue_date,
          dueDate: invoiceRow.due_date,
          title: invoiceRow.title,
          total: invoiceRow.total,
        });
        entriesByCustomerId.set(invoiceRow.customer_id, existingEntries);
        const latestUpdatedAt = latestInvoiceUpdatedAtByCustomerId.get(invoiceRow.customer_id);
        if (!latestUpdatedAt || invoiceRow.updated_at > latestUpdatedAt) {
          latestInvoiceUpdatedAtByCustomerId.set(invoiceRow.customer_id, invoiceRow.updated_at);
        }
      }

      const customerStatements = customerRows.map((customerRow) => {
        const customer = mapCustomerRow(customerRow);
        const entries = entriesByCustomerId.get(customer.id) ?? [];
        const periodTotal = entries.reduce((sum, entry) => sum + entry.total, 0);
        const latestInvoiceUpdatedAt = latestInvoiceUpdatedAtByCustomerId.get(customer.id);
        const generatedAt =
          latestInvoiceUpdatedAt && latestInvoiceUpdatedAt > customer.updatedAt
            ? latestInvoiceUpdatedAt
            : customer.updatedAt;
        const statement: CustomerStatementReport = {
          customer,
          generatedAt,
          period: {
            from: null,
            to: null,
          },
          openingBalance: 0,
          periodTotal,
          closingBalance: periodTotal,
          entries,
          creditsSupported: false,
          creditsOmittedReason: 'Credits are not supported in the current invoice architecture.',
        };
        return {
          customerId: customer.id,
          statement,
        };
      });

      const entities = {} as Record<PlatformSnapshotTable, PlatformSnapshotRow[]>;
      for (const table of PLATFORM_SNAPSHOT_TABLES) {
        entities[table] = snapshotTableRows(table);
      }

      return {
        version: PLATFORM_SNAPSHOT_VERSION,
        products: [],
        derived: {
          customerStatements,
        },
        entities,
      };
    },

    restorePlatformSnapshot(snapshot) {
      const parsedSnapshot = parseAndValidateSnapshot(snapshot);
      restorePlatformSnapshot(parsedSnapshot);
    },
  };
}
