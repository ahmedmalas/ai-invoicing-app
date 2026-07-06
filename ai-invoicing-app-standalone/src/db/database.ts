import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  BrandingProfile,
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
  Team,
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
import { assertAssignmentInTeamScopeOrThrow } from '../domain/teams/assignment-scope.js';

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
  createdAt: string;
  user: User;
}

export interface SearchResults {
  customers: Customer[];
  invoices: InvoiceDraft[];
  documents: DocumentRecord[];
  jobs: Job[];
}

export interface JobDocumentLinkRecord {
  id: string;
  jobId: string;
  documentId: string;
  createdAt: string;
  document: DocumentRecord;
}

export interface AppDatabase {
  close(): void;
  createCustomer(input: CreateCustomerInput): Customer;
  updateCustomer(id: string, input: UpdateCustomerInput): Customer;
  getCustomerById(id: string): Customer | null;
  upsertBusinessProfile(input: UpsertBusinessProfileInput): BrandingProfile;
  getBusinessProfile(): BrandingProfile | null;
  upsertPreference(key: string, value: unknown): void;
  getPreference(key: string): unknown;
  createInvoiceDraft(input: CreateInvoiceDraftInput): InvoiceDraft;
  updateInvoiceDraft(id: string, input: UpdateInvoiceDraftInput): InvoiceDraft;
  getInvoiceById(id: string): (InvoiceDraft & { lineItems: LineItemInput[] }) | null;
  finaliseInvoice(id: string): InvoiceDraft;
  createRole(input: CreateRoleInput): Role;
  getRoleById(id: string): Role | null;
  listRoles(): Role[];
  createUser(input: CreateUserInput): User;
  getUserById(id: string): User | null;
  listUsers(): User[];
  createTeam(input: CreateTeamInput): Team;
  getTeamById(id: string): Team | null;
  listTeams(): Team[];
  deleteTeam(teamId: string): void;
  addTeamMember(teamId: string, userId: string): TeamMembershipRecord;
  removeTeamMember(teamId: string, userId: string): void;
  listTeamMembers(teamId: string): TeamMembershipRecord[];
  createJob(input: CreateJobInput): Job;
  updateJob(id: string, input: UpdateJobInput): Job;
  getJobById(id: string): Job | null;
  listJobs(): Job[];
  linkDocumentToJob(jobId: string, documentId: string): JobDocumentLinkRecord;
  listJobDocuments(jobId: string): JobDocumentLinkRecord[];
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

    deleteTeam(teamId) {
      ensureTeamExistsOrThrow(teamId);

      const memberCount = db
        .prepare(
          `SELECT COUNT(1) AS total
           FROM team_memberships
           WHERE team_id = ?`,
        )
        .get(teamId) as { total: number };
      if (memberCount.total > 0) {
        throw new Error('TEAM_HAS_MEMBERS');
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

      db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
      timeline('team.deleted', teamId, {});
    },

    addTeamMember(teamId, userId) {
      ensureTeamExistsOrThrow(teamId);
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const id = randomUUID();
      const now = nowIso();
      try {
        db.prepare(
          `INSERT INTO team_memberships (id, team_id, user_id, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(id, teamId, userId, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('UNIQUE constraint failed: team_memberships.team_id, team_memberships.user_id')) {
          throw new Error('TEAM_MEMBER_EXISTS');
        }
        throw error;
      }

      timeline('team.member_added', teamId, {
        userId,
      });

      return {
        id,
        teamId,
        userId,
        createdAt: now,
        user,
      };
    },

    removeTeamMember(teamId, userId) {
      ensureTeamExistsOrThrow(teamId);
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const membership = db
        .prepare(
          `SELECT id
           FROM team_memberships
           WHERE team_id = ? AND user_id = ?`,
        )
        .get(teamId, userId) as { id: string } | undefined;
      if (!membership) {
        throw new Error('TEAM_MEMBER_NOT_FOUND');
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
      });
    },

    listTeamMembers(teamId) {
      ensureTeamExistsOrThrow(teamId);
      const rows = db
        .prepare(
          `SELECT
             tm.id AS id,
             tm.team_id AS team_id,
             tm.user_id AS user_id,
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
