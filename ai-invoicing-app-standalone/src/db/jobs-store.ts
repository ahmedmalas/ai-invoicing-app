import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  CANONICAL_JOB_STATUSES,
  DEFAULT_STATUS_COLOURS,
  type AssignmentResponseStatus,
} from '../domain/jobs/statuses.js';
import type {
  CalendarJobEvent,
  CustomerPortalSession,
  EnrichedJob,
  JobAssignment,
  JobChecklistItem,
  JobFormSubmission,
  JobFormTemplate,
  JobLabourLine,
  JobNotification,
  JobPartLine,
  JobRecurrenceRule,
  JobSignature,
  JobStatusDefinition,
  JobTimeEntry,
  RouteStop,
} from '../domain/jobs/types.js';
import type { Job, JobPriority } from '../types/entities.js';
import type { JobStatus } from '../domain/jobs/statuses.js';

const JOB_EXTRA_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'site_address', ddl: 'ALTER TABLE jobs ADD COLUMN site_address TEXT' },
  { name: 'suburb', ddl: 'ALTER TABLE jobs ADD COLUMN suburb TEXT' },
  { name: 'contact_person', ddl: 'ALTER TABLE jobs ADD COLUMN contact_person TEXT' },
  { name: 'contact_phone', ddl: 'ALTER TABLE jobs ADD COLUMN contact_phone TEXT' },
  { name: 'internal_notes', ddl: 'ALTER TABLE jobs ADD COLUMN internal_notes TEXT' },
  { name: 'customer_notes', ddl: 'ALTER TABLE jobs ADD COLUMN customer_notes TEXT' },
  { name: 'colour', ddl: 'ALTER TABLE jobs ADD COLUMN colour TEXT' },
  { name: 'quote_id', ddl: 'ALTER TABLE jobs ADD COLUMN quote_id TEXT' },
  { name: 'invoice_id', ddl: 'ALTER TABLE jobs ADD COLUMN invoice_id TEXT' },
  { name: 'latitude', ddl: 'ALTER TABLE jobs ADD COLUMN latitude REAL' },
  { name: 'longitude', ddl: 'ALTER TABLE jobs ADD COLUMN longitude REAL' },
  {
    name: 'estimated_travel_minutes',
    ddl: 'ALTER TABLE jobs ADD COLUMN estimated_travel_minutes INTEGER',
  },
];

export function ensureJobsSchemaSqlite(db: Database.Database, nowIso: () => string): void {
  const columns = (
    db.prepare("SELECT name FROM pragma_table_info('jobs')").all() as Array<{ name: string }>
  ).map((row) => row.name);
  const columnSet = new Set(columns);
  for (const column of JOB_EXTRA_COLUMNS) {
    if (!columnSet.has(column.name)) {
      db.exec(column.ddl);
    }
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS job_status_definitions (
  id TEXT PRIMARY KEY,
  status_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  colour TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_terminal INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  team_id TEXT,
  response_status TEXT NOT NULL DEFAULT 'pending',
  is_primary INTEGER NOT NULL DEFAULT 0,
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, user_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_time_entries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT,
  entry_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_checklist_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  label TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_parts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_labour (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  description TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 1,
  user_id TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_signatures (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  signature_data_url TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  purpose TEXT NOT NULL DEFAULT 'completion',
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_form_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_form_submissions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  submitted_by TEXT,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (template_id) REFERENCES job_form_templates(id)
);
CREATE TABLE IF NOT EXISTS job_recurrence_rules (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL,
  interval_count INTEGER NOT NULL DEFAULT 1,
  until_date TEXT,
  by_weekday TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS job_notifications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_for TEXT,
  sent_at TEXT,
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS customer_portal_tokens (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_job_assign_job ON job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_job_assign_user ON job_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_job_time_job ON job_time_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_job_notifications_job ON job_notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_portal_token ON customer_portal_tokens(token);
`);

  const count = db.prepare('SELECT count(*) AS c FROM job_status_definitions').get() as {
    c: number;
  };
  if (count.c === 0) {
    const insert = db.prepare(
      `INSERT INTO job_status_definitions (
        id, status_key, label, colour, sort_order, is_terminal, is_default, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const now = nowIso();
    CANONICAL_JOB_STATUSES.forEach((status, index) => {
      insert.run(
        randomUUID(),
        status,
        status,
        DEFAULT_STATUS_COLOURS[status],
        index,
        ['Completed', 'Cancelled', 'Paid'].includes(status) ? 1 : 0,
        status === 'Draft' ? 1 : 0,
        now,
        now,
      );
    });
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function mapExtendedJobRow(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    jobNumber: String(row.job_number),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    customerId: String(row.customer_id),
    status: row.status as JobStatus,
    priority: row.priority as JobPriority,
    scheduledStartAt: (row.scheduled_start_at as string | null) ?? null,
    scheduledEndAt: (row.scheduled_end_at as string | null) ?? null,
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    assignedUserName: (row.assigned_user_name as string | null) ?? null,
    teamId: (row.team_id as string | null) ?? null,
    completedDate: (row.completed_date as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    siteAddress: (row.site_address as string | null) ?? null,
    suburb: (row.suburb as string | null) ?? null,
    contactPerson: (row.contact_person as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    internalNotes: (row.internal_notes as string | null) ?? null,
    customerNotes: (row.customer_notes as string | null) ?? null,
    colour: (row.colour as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    estimatedTravelMinutes:
      row.estimated_travel_minutes == null ? null : Number(row.estimated_travel_minutes),
  };
}

export interface JobsStoreDeps {
  db: Database.Database;
  nowIso: () => string;
  timeline: (eventKey: string, entityId: string, payload: unknown) => void;
  getJobById: (id: string) => Job | null;
  updateJobSchedule: (
    id: string,
    input: {
      scheduledStartAt: string;
      scheduledEndAt: string;
      assignedUserId?: string | null;
    },
  ) => Job;
}

export function createSqliteJobsStore(deps: JobsStoreDeps) {
  const { db, nowIso, timeline, getJobById, updateJobSchedule } = deps;

  function listAssignments(jobId: string): JobAssignment[] {
    const rows = db
      .prepare('SELECT * FROM job_assignments WHERE job_id = ? ORDER BY is_primary DESC, created_at ASC')
      .all(jobId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      userId: String(row.user_id),
      userName: String(row.user_name ?? ''),
      teamId: (row.team_id as string | null) ?? null,
      responseStatus: row.response_status as AssignmentResponseStatus,
      isPrimary: Number(row.is_primary) === 1,
      respondedAt: (row.responded_at as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  function syncPrimaryAssignment(jobId: string): void {
    const primary = db
      .prepare(
        `SELECT user_id, user_name FROM job_assignments
         WHERE job_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      )
      .get(jobId) as { user_id: string; user_name: string } | undefined;
    db.prepare(
      `UPDATE jobs SET assigned_user_id = ?, assigned_user_name = ?, updated_at = ? WHERE id = ?`,
    ).run(primary?.user_id ?? null, primary?.user_name ?? null, nowIso(), jobId);
  }

  function replaceAssignments(
    jobId: string,
    assignments: Array<{
      userId: string;
      userName?: string;
      teamId?: string | null;
      isPrimary?: boolean;
      responseStatus?: AssignmentResponseStatus;
    }>,
  ): JobAssignment[] {
    db.prepare('DELETE FROM job_assignments WHERE job_id = ?').run(jobId);
    const now = nowIso();
    const insert = db.prepare(
      `INSERT INTO job_assignments (
        id, job_id, user_id, user_name, team_id, response_status, is_primary, responded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    );
    assignments.forEach((assignment, index) => {
      const user = db
        .prepare('SELECT id, display_name FROM users WHERE id = ?')
        .get(assignment.userId) as { id: string; display_name: string } | undefined;
      if (!user) throw new Error('ASSIGNED_USER_NOT_FOUND');
      insert.run(
        randomUUID(),
        jobId,
        user.id,
        assignment.userName ?? user.display_name,
        assignment.teamId ?? null,
        assignment.responseStatus ?? 'pending',
        assignment.isPrimary || index === 0 ? 1 : 0,
        now,
        now,
      );
    });
    syncPrimaryAssignment(jobId);
    timeline('job.assignment_updated', jobId, {
      assigneeCount: assignments.length,
      userIds: assignments.map((a) => a.userId),
    });
    const job = getJobById(jobId);
    if (job && assignments.length > 0 && job.status === 'Scheduled') {
      db.prepare(`UPDATE jobs SET status = 'Assigned', updated_at = ? WHERE id = ?`).run(now, jobId);
      timeline('job.status_changed', jobId, { from: 'Scheduled', to: 'Assigned' });
    }
    return listAssignments(jobId);
  }

  function updateAssignmentResponse(
    jobId: string,
    userId: string,
    responseStatus: AssignmentResponseStatus,
  ): JobAssignment {
    const now = nowIso();
    const result = db
      .prepare(
        `UPDATE job_assignments SET response_status = ?, responded_at = ?, updated_at = ?
         WHERE job_id = ? AND user_id = ?`,
      )
      .run(responseStatus, now, now, jobId, userId);
    if (result.changes < 1) throw new Error('JOB_ASSIGNMENT_NOT_FOUND');

    // Mirror technician progress onto job status when useful
    const statusMap: Partial<Record<AssignmentResponseStatus, JobStatus>> = {
      en_route: 'Travelling',
      arrived: 'On Site',
      started: 'Commenced',
      finished: 'Completed',
    };
    const nextStatus = statusMap[responseStatus];
    if (nextStatus) {
      db.prepare(`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, now, jobId);
      timeline('job.status_changed', jobId, { to: nextStatus, via: 'assignment_response' });
      if (responseStatus === 'en_route') {
        queueNotification(jobId, {
          kind: 'technician_on_the_way',
          channel: 'email',
          recipient: resolveCustomerEmail(jobId) ?? 'customer@example.com',
          subject: 'Technician on the way',
          body: 'Your technician is en route.',
        });
      }
      if (responseStatus === 'arrived') {
        queueNotification(jobId, {
          kind: 'arrival',
          channel: 'email',
          recipient: resolveCustomerEmail(jobId) ?? 'customer@example.com',
          subject: 'Technician arrived',
          body: 'Your technician has arrived on site.',
        });
      }
      if (responseStatus === 'finished') {
        queueNotification(jobId, {
          kind: 'job_completed',
          channel: 'email',
          recipient: resolveCustomerEmail(jobId) ?? 'customer@example.com',
          subject: 'Job completed',
          body: 'Your job has been marked completed.',
        });
      }
    }
    const row = db
      .prepare('SELECT * FROM job_assignments WHERE job_id = ? AND user_id = ?')
      .get(jobId, userId) as Record<string, unknown>;
    return listAssignments(jobId).find((a) => a.userId === userId)!;
  }

  function resolveCustomerEmail(jobId: string): string | null {
    const row = db
      .prepare(
        `SELECT c.email AS email FROM jobs j
         INNER JOIN customers c ON c.id = j.customer_id WHERE j.id = ?`,
      )
      .get(jobId) as { email: string | null } | undefined;
    return row?.email ?? null;
  }

  function listChecklist(jobId: string): JobChecklistItem[] {
    return (
      db
        .prepare('SELECT * FROM job_checklist_items WHERE job_id = ? ORDER BY sort_order ASC')
        .all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      label: String(row.label),
      completed: Number(row.completed) === 1,
      sortOrder: Number(row.sort_order),
      completedAt: (row.completed_at as string | null) ?? null,
      completedBy: (row.completed_by as string | null) ?? null,
    }));
  }

  function replaceChecklist(
    jobId: string,
    items: Array<{ id?: string; label: string; completed?: boolean; sortOrder?: number }>,
  ): JobChecklistItem[] {
    db.prepare('DELETE FROM job_checklist_items WHERE job_id = ?').run(jobId);
    const insert = db.prepare(
      `INSERT INTO job_checklist_items (
        id, job_id, label, completed, sort_order, completed_at, completed_by
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    items.forEach((item, index) => {
      insert.run(
        item.id ?? randomUUID(),
        jobId,
        item.label,
        item.completed ? 1 : 0,
        item.sortOrder ?? index,
        item.completed ? nowIso() : null,
      );
    });
    return listChecklist(jobId);
  }

  function addTimeEntry(jobId: string, input: {
    userId?: string | null;
    entryType: string;
    startedAt: string;
    endedAt?: string | null;
    breakMinutes?: number;
    billable?: boolean;
    notes?: string | null;
  }): JobTimeEntry {
    if (!getJobById(jobId)) throw new Error('Job not found');
    const id = randomUUID();
    db.prepare(
      `INSERT INTO job_time_entries (
        id, job_id, user_id, entry_type, started_at, ended_at, break_minutes, billable, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      jobId,
      input.userId ?? null,
      input.entryType,
      input.startedAt,
      input.endedAt ?? null,
      input.breakMinutes ?? 0,
      input.billable === false ? 0 : 1,
      input.notes ?? null,
      nowIso(),
    );
    return listTimeEntries(jobId).find((entry) => entry.id === id)!;
  }

  function listTimeEntries(jobId: string): JobTimeEntry[] {
    return (
      db
        .prepare('SELECT * FROM job_time_entries WHERE job_id = ? ORDER BY started_at ASC')
        .all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      userId: (row.user_id as string | null) ?? null,
      entryType: row.entry_type as JobTimeEntry['entryType'],
      startedAt: String(row.started_at),
      endedAt: (row.ended_at as string | null) ?? null,
      breakMinutes: Number(row.break_minutes),
      billable: Number(row.billable) === 1,
      notes: (row.notes as string | null) ?? null,
      createdAt: String(row.created_at),
    }));
  }

  function summarizeTime(jobId: string) {
    const entries = listTimeEntries(jobId);
    let totalMinutes = 0;
    let billableMinutes = 0;
    let travelMinutes = 0;
    let overtimeMinutes = 0;
    for (const entry of entries) {
      if (!entry.endedAt) continue;
      const mins =
        Math.max(0, (Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 60000) -
        entry.breakMinutes;
      totalMinutes += mins;
      if (entry.billable) billableMinutes += mins;
      if (entry.entryType === 'travel') travelMinutes += mins;
      if (entry.entryType === 'overtime') overtimeMinutes += mins;
    }
    return {
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      billableHours: Math.round((billableMinutes / 60) * 100) / 100,
      travelHours: Math.round((travelMinutes / 60) * 100) / 100,
      overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
      entries,
    };
  }

  function addPart(jobId: string, input: {
    description: string;
    quantity: number;
    unitCost: number;
    billable?: boolean;
  }): JobPartLine {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO job_parts (id, job_id, description, quantity, unit_cost, billable)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, jobId, input.description, input.quantity, input.unitCost, input.billable === false ? 0 : 1);
    return listParts(jobId).find((part) => part.id === id)!;
  }

  function listParts(jobId: string): JobPartLine[] {
    return (
      db.prepare('SELECT * FROM job_parts WHERE job_id = ?').all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      description: String(row.description),
      quantity: Number(row.quantity),
      unitCost: Number(row.unit_cost),
      billable: Number(row.billable) === 1,
    }));
  }

  function addLabour(jobId: string, input: {
    description: string;
    hours: number;
    rate: number;
    billable?: boolean;
    userId?: string | null;
  }): JobLabourLine {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO job_labour (id, job_id, description, hours, rate, billable, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      jobId,
      input.description,
      input.hours,
      input.rate,
      input.billable === false ? 0 : 1,
      input.userId ?? null,
    );
    return listLabour(jobId).find((line) => line.id === id)!;
  }

  function listLabour(jobId: string): JobLabourLine[] {
    return (
      db.prepare('SELECT * FROM job_labour WHERE job_id = ?').all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      description: String(row.description),
      hours: Number(row.hours),
      rate: Number(row.rate),
      billable: Number(row.billable) === 1,
      userId: (row.user_id as string | null) ?? null,
    }));
  }

  function addSignature(jobId: string, input: {
    signerName: string;
    signatureDataUrl: string;
    signedAt?: string;
    latitude?: number | null;
    longitude?: number | null;
    purpose?: JobSignature['purpose'];
  }): JobSignature {
    if (!getJobById(jobId)) throw new Error('Job not found');
    const id = randomUUID();
    const signedAt = input.signedAt ?? nowIso();
    db.prepare(
      `INSERT INTO job_signatures (
        id, job_id, signer_name, signed_at, signature_data_url, latitude, longitude, purpose, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      jobId,
      input.signerName,
      signedAt,
      input.signatureDataUrl,
      input.latitude ?? null,
      input.longitude ?? null,
      input.purpose ?? 'completion',
      nowIso(),
    );
    timeline('job.updated', jobId, { signatureCaptured: true, signerName: input.signerName });
    return listSignatures(jobId).find((sig) => sig.id === id)!;
  }

  function listSignatures(jobId: string): JobSignature[] {
    return (
      db
        .prepare('SELECT * FROM job_signatures WHERE job_id = ? ORDER BY signed_at DESC')
        .all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      signerName: String(row.signer_name),
      signedAt: String(row.signed_at),
      signatureDataUrl: String(row.signature_data_url),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      purpose: row.purpose as JobSignature['purpose'],
      createdAt: String(row.created_at),
    }));
  }

  function listStatusDefinitions(): JobStatusDefinition[] {
    return (
      db
        .prepare('SELECT * FROM job_status_definitions ORDER BY sort_order ASC')
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      key: String(row.status_key),
      label: String(row.label),
      colour: String(row.colour),
      sortOrder: Number(row.sort_order),
      isTerminal: Number(row.is_terminal) === 1,
      isDefault: Number(row.is_default) === 1,
      active: Number(row.active) === 1,
    }));
  }

  function upsertStatusDefinition(input: {
    key: string;
    label: string;
    colour: string;
    sortOrder?: number;
    isTerminal?: boolean;
    isDefault?: boolean;
    active?: boolean;
  }): JobStatusDefinition {
    const existing = db
      .prepare('SELECT id FROM job_status_definitions WHERE status_key = ?')
      .get(input.key) as { id: string } | undefined;
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE job_status_definitions SET
          label = ?, colour = ?, sort_order = ?, is_terminal = ?, is_default = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.label,
        input.colour,
        input.sortOrder ?? 0,
        input.isTerminal ? 1 : 0,
        input.isDefault ? 1 : 0,
        input.active === false ? 0 : 1,
        now,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO job_status_definitions (
          id, status_key, label, colour, sort_order, is_terminal, is_default, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.key,
        input.label,
        input.colour,
        input.sortOrder ?? 0,
        input.isTerminal ? 1 : 0,
        input.isDefault ? 1 : 0,
        input.active === false ? 0 : 1,
        now,
        now,
      );
    }
    return listStatusDefinitions().find((status) => status.key === input.key)!;
  }

  function createFormTemplate(input: {
    name: string;
    kind: string;
    schemaJson?: Record<string, unknown>;
    active?: boolean;
  }): JobFormTemplate {
    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO job_form_templates (id, name, kind, schema_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.name, input.kind, json(input.schemaJson ?? {}), input.active === false ? 0 : 1, now, now);
    return listFormTemplates().find((template) => template.id === id)!;
  }

  function listFormTemplates(): JobFormTemplate[] {
    return (
      db
        .prepare('SELECT * FROM job_form_templates ORDER BY created_at DESC')
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: row.kind as JobFormTemplate['kind'],
      schemaJson: JSON.parse(String(row.schema_json || '{}')) as Record<string, unknown>,
      active: Number(row.active) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  function submitForm(jobId: string, input: {
    templateId: string;
    answersJson?: Record<string, unknown>;
    submittedBy?: string | null;
  }): JobFormSubmission {
    if (!getJobById(jobId)) throw new Error('Job not found');
    const template = db
      .prepare('SELECT id FROM job_form_templates WHERE id = ?')
      .get(input.templateId);
    if (!template) throw new Error('FORM_TEMPLATE_NOT_FOUND');
    const id = randomUUID();
    const submittedAt = nowIso();
    db.prepare(
      `INSERT INTO job_form_submissions (
        id, job_id, template_id, answers_json, submitted_by, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, jobId, input.templateId, json(input.answersJson ?? {}), input.submittedBy ?? null, submittedAt);
    return {
      id,
      jobId,
      templateId: input.templateId,
      answersJson: input.answersJson ?? {},
      submittedBy: input.submittedBy ?? null,
      submittedAt,
    };
  }

  function setRecurrence(jobId: string, input: {
    frequency: 'daily' | 'weekly' | 'monthly';
    interval?: number;
    untilDate?: string | null;
    byWeekday?: string | null;
  }): JobRecurrenceRule {
    if (!getJobById(jobId)) throw new Error('Job not found');
    db.prepare('DELETE FROM job_recurrence_rules WHERE job_id = ?').run(jobId);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO job_recurrence_rules (
        id, job_id, frequency, interval_count, until_date, by_weekday, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      jobId,
      input.frequency,
      input.interval ?? 1,
      input.untilDate ?? null,
      input.byWeekday ?? null,
      nowIso(),
    );
    return {
      id,
      jobId,
      frequency: input.frequency,
      interval: input.interval ?? 1,
      untilDate: input.untilDate ?? null,
      byWeekday: input.byWeekday ?? null,
      createdAt: nowIso(),
    };
  }

  function queueNotification(
    jobId: string,
    input: {
      kind: JobNotification['kind'];
      channel: JobNotification['channel'];
      recipient: string;
      subject: string;
      body: string;
      scheduledFor?: string | null;
    },
  ): JobNotification {
    const id = randomUUID();
    const createdAt = nowIso();
    // In-app/email queue — SMS/push provider_ref reserved for future integrations
    db.prepare(
      `INSERT INTO job_notifications (
        id, job_id, kind, channel, recipient, subject, body, status, scheduled_for, sent_at, provider_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?)`,
    ).run(
      id,
      jobId,
      input.kind,
      input.channel,
      input.recipient,
      input.subject,
      input.body,
      input.scheduledFor ?? null,
      createdAt,
    );
    // Auto-mark email/in_app as sent for local delivery simulation
    if (input.channel === 'email' || input.channel === 'in_app') {
      db.prepare(
        `UPDATE job_notifications SET status = 'sent', sent_at = ? WHERE id = ?`,
      ).run(createdAt, id);
    }
    return listNotifications(jobId).find((item) => item.id === id)!;
  }

  function listNotifications(jobId: string): JobNotification[] {
    return (
      db
        .prepare('SELECT * FROM job_notifications WHERE job_id = ? ORDER BY created_at DESC')
        .all(jobId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      kind: row.kind as JobNotification['kind'],
      channel: row.channel as JobNotification['channel'],
      recipient: String(row.recipient),
      subject: String(row.subject),
      body: String(row.body),
      status: row.status as JobNotification['status'],
      scheduledFor: (row.scheduled_for as string | null) ?? null,
      sentAt: (row.sent_at as string | null) ?? null,
      createdAt: String(row.created_at),
      providerRef: (row.provider_ref as string | null) ?? null,
    }));
  }

  function getEnrichedJob(jobId: string): EnrichedJob | null {
    const job = getJobById(jobId);
    if (!job) return null;
    return {
      ...job,
      siteAddress: job.siteAddress ?? null,
      suburb: job.suburb ?? null,
      contactPerson: job.contactPerson ?? null,
      contactPhone: job.contactPhone ?? null,
      internalNotes: job.internalNotes ?? null,
      customerNotes: job.customerNotes ?? null,
      colour: job.colour ?? null,
      quoteId: job.quoteId ?? null,
      invoiceId: job.invoiceId ?? null,
      latitude: job.latitude ?? null,
      longitude: job.longitude ?? null,
      estimatedTravelMinutes: job.estimatedTravelMinutes ?? null,
      assignments: listAssignments(jobId),
      checklist: listChecklist(jobId),
      timeEntries: listTimeEntries(jobId),
      parts: listParts(jobId),
      labour: listLabour(jobId),
      signatures: listSignatures(jobId),
    };
  }

  function listCalendarEvents(filter: {
    from: string;
    to: string;
    technicianId?: string;
    customerId?: string;
    priority?: string;
    suburb?: string;
    status?: string;
    teamId?: string;
  }): CalendarJobEvent[] {
    const rows = db
      .prepare(
        `SELECT j.*, c.display_name AS customer_name
         FROM jobs j
         LEFT JOIN customers c ON c.id = j.customer_id
         WHERE j.scheduled_start_at IS NOT NULL
           AND j.scheduled_end_at IS NOT NULL
           AND j.scheduled_start_at <= ?
           AND j.scheduled_end_at >= ?
           AND (? IS NULL OR j.customer_id = ?)
           AND (? IS NULL OR j.priority = ?)
           AND (? IS NULL OR lower(coalesce(j.suburb, '')) LIKE ?)
           AND (? IS NULL OR j.status = ?)
           AND (? IS NULL OR j.team_id = ?)
           AND (
             ? IS NULL OR j.assigned_user_id = ? OR EXISTS (
               SELECT 1 FROM job_assignments ja
               WHERE ja.job_id = j.id AND ja.user_id = ?
             )
           )
         ORDER BY j.scheduled_start_at ASC`,
      )
      .all(
        filter.to,
        filter.from,
        filter.customerId ?? null,
        filter.customerId ?? null,
        filter.priority ?? null,
        filter.priority ?? null,
        filter.suburb ? `%${filter.suburb.toLowerCase()}%` : null,
        filter.suburb ? `%${filter.suburb.toLowerCase()}%` : null,
        filter.status ?? null,
        filter.status ?? null,
        filter.teamId ?? null,
        filter.teamId ?? null,
        filter.technicianId ?? null,
        filter.technicianId ?? null,
        filter.technicianId ?? null,
      ) as Array<Record<string, unknown>>;

    const statusColours = Object.fromEntries(
      listStatusDefinitions().map((status) => [status.key, status.colour]),
    );

    return rows.map((row) => {
      const job = mapExtendedJobRow(row);
      const assignments = listAssignments(job.id);
      return {
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
        status: job.status,
        priority: job.priority,
        colour:
          job.colour ||
          statusColours[job.status] ||
          DEFAULT_STATUS_COLOURS[job.status as keyof typeof DEFAULT_STATUS_COLOURS] ||
          '#3B82F6',
        customerId: job.customerId,
        customerName: (row.customer_name as string | null) ?? null,
        suburb: job.suburb ?? null,
        scheduledStartAt: job.scheduledStartAt!,
        scheduledEndAt: job.scheduledEndAt!,
        assignedUserIds: assignments.length
          ? assignments.map((a) => a.userId)
          : job.assignedUserId
            ? [job.assignedUserId]
            : [],
        teamId: job.teamId,
      };
    });
  }

  function rescheduleJob(
    jobId: string,
    input: { scheduledStartAt: string; scheduledEndAt: string; assignedUserId?: string | null },
  ): Job {
    const job = updateJobSchedule(jobId, input);
    timeline('job.scheduled', jobId, {
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      dragDrop: true,
    });
    return job;
  }

  function buildDailyRoute(technicianId: string, day: string): RouteStop[] {
    const from = `${day}T00:00:00.000Z`;
    const to = `${day}T23:59:59.999Z`;
    const events = listCalendarEvents({ from, to, technicianId });
    return events.map((event, index) => {
      const job = getJobById(event.id);
      const address = job?.siteAddress || event.suburb || null;
      const mapsUrl = address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : job?.latitude != null && job.longitude != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`
          : null;
      return {
        jobId: event.id,
        title: event.title,
        siteAddress: job?.siteAddress ?? null,
        suburb: event.suburb,
        latitude: job?.latitude ?? null,
        longitude: job?.longitude ?? null,
        scheduledStartAt: event.scheduledStartAt,
        estimatedTravelMinutes: job?.estimatedTravelMinutes ?? (index === 0 ? 0 : 20),
        mapsUrl,
      };
    });
  }

  function createPortalToken(customerId: string, expiresInHours = 72): CustomerPortalSession {
    const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw new Error('Customer not found');
    const id = randomUUID();
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600_000).toISOString();
    db.prepare(
      `INSERT INTO customer_portal_tokens (id, customer_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, customerId, token, expiresAt, createdAt);
    return { id, customerId, token, expiresAt, createdAt };
  }

  function resolvePortalToken(token: string): CustomerPortalSession | null {
    const row = db
      .prepare('SELECT * FROM customer_portal_tokens WHERE token = ?')
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (String(row.expires_at) < nowIso()) return null;
    return {
      id: String(row.id),
      customerId: String(row.customer_id),
      token: String(row.token),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  function getPortalSnapshot(customerId: string) {
    const jobs = (
      db
        .prepare(
          `SELECT * FROM jobs WHERE customer_id = ?
           ORDER BY coalesce(scheduled_start_at, created_at) DESC`,
        )
        .all(customerId) as Array<Record<string, unknown>>
    ).map(mapExtendedJobRow);

    const quotes = db
      .prepare(
        `SELECT id, quote_number, title, status, total, issue_date, expiry_date
         FROM quotes WHERE customer_id = ? ORDER BY created_at DESC`,
      )
      .all(customerId) as Array<Record<string, unknown>>;

    const invoices = db
      .prepare(
        `SELECT id, invoice_number, title, status, payment_state, total, issue_date, due_date
         FROM invoices WHERE customer_id = ? ORDER BY created_at DESC`,
      )
      .all(customerId) as Array<Record<string, unknown>>;

    return {
      jobs: jobs.map((job) => ({
        ...job,
        signatures: listSignatures(job.id).map((sig) => ({
          id: sig.id,
          signerName: sig.signerName,
          signedAt: sig.signedAt,
          purpose: sig.purpose,
        })),
        checklist: listChecklist(job.id),
      })),
      quotes,
      invoices,
      appointments: jobs.filter(
        (job) =>
          job.scheduledStartAt &&
          !['Cancelled', 'Draft'].includes(job.status),
      ),
    };
  }

  function applyJobExtras(
    jobId: string,
    extras: Partial<{
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
    }>,
  ): void {
    db.prepare(
      `UPDATE jobs SET
        site_address = coalesce(?, site_address),
        suburb = coalesce(?, suburb),
        contact_person = coalesce(?, contact_person),
        contact_phone = coalesce(?, contact_phone),
        internal_notes = coalesce(?, internal_notes),
        customer_notes = coalesce(?, customer_notes),
        colour = coalesce(?, colour),
        quote_id = coalesce(?, quote_id),
        invoice_id = coalesce(?, invoice_id),
        latitude = coalesce(?, latitude),
        longitude = coalesce(?, longitude),
        estimated_travel_minutes = coalesce(?, estimated_travel_minutes),
        updated_at = ?
      WHERE id = ?`,
    ).run(
      extras.siteAddress ?? null,
      extras.suburb ?? null,
      extras.contactPerson ?? null,
      extras.contactPhone ?? null,
      extras.internalNotes ?? null,
      extras.customerNotes ?? null,
      extras.colour ?? null,
      extras.quoteId ?? null,
      extras.invoiceId ?? null,
      extras.latitude ?? null,
      extras.longitude ?? null,
      extras.estimatedTravelMinutes ?? null,
      nowIso(),
      jobId,
    );
  }

  /** coalesce trick above can't clear fields — dedicated patch for explicit nulls/values */
  function patchJobExtras(
    jobId: string,
    extras: Record<string, string | number | null | undefined>,
  ): void {
    const mapping: Record<string, string> = {
      siteAddress: 'site_address',
      suburb: 'suburb',
      contactPerson: 'contact_person',
      contactPhone: 'contact_phone',
      internalNotes: 'internal_notes',
      customerNotes: 'customer_notes',
      colour: 'colour',
      quoteId: 'quote_id',
      invoiceId: 'invoice_id',
      latitude: 'latitude',
      longitude: 'longitude',
      estimatedTravelMinutes: 'estimated_travel_minutes',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(extras, key)) {
        sets.push(`${column} = ?`);
        values.push(extras[key] ?? null);
      }
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(nowIso(), jobId);
    db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  return {
    listAssignments,
    replaceAssignments,
    updateAssignmentResponse,
    listChecklist,
    replaceChecklist,
    addTimeEntry,
    listTimeEntries,
    summarizeTime,
    addPart,
    listParts,
    addLabour,
    listLabour,
    addSignature,
    listSignatures,
    listStatusDefinitions,
    upsertStatusDefinition,
    createFormTemplate,
    listFormTemplates,
    submitForm,
    setRecurrence,
    queueNotification,
    listNotifications,
    getEnrichedJob,
    listCalendarEvents,
    rescheduleJob,
    buildDailyRoute,
    createPortalToken,
    resolvePortalToken,
    getPortalSnapshot,
    applyJobExtras,
    patchJobExtras,
  };
}

export type SqliteJobsStore = ReturnType<typeof createSqliteJobsStore>;

export const JOBS_SNAPSHOT_TABLES = [
  'job_status_definitions',
  'job_assignments',
  'job_time_entries',
  'job_checklist_items',
  'job_parts',
  'job_labour',
  'job_signatures',
  'job_form_templates',
  'job_form_submissions',
  'job_recurrence_rules',
  'job_notifications',
  'customer_portal_tokens',
] as const;
