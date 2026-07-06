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
  LineItemInput,
  PaymentState,
  ReminderState,
  TimelineEventType,
  UUID,
} from '../types/entities.js';
import { calculateTotals } from '../domain/invoices/gst.js';
import { formatInvoiceNumber } from '../domain/invoices/numbering.js';

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

export interface UpdateInvoiceDraftInput {
  title: string;
  issueDate: string;
  dueDate: string;
  notes?: string | undefined;
  paymentTerms?: string | undefined;
  lineItems: LineItemInput[];
  paymentState: PaymentState;
}

export interface SearchResults {
  customers: Customer[];
  invoices: InvoiceDraft[];
  documents: DocumentRecord[];
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
  getTimelineForEntity(entityType: string, entityId: string): unknown[];
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

export function createDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(schemaSql);

  const insertTimeline = db.prepare(
    `INSERT INTO timeline_events (id, entity_type, entity_id, event_type, event_payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  function timeline(entityType: string, entityId: string, eventType: TimelineEventType, payload: unknown): void {
    insertTimeline.run(
      randomUUID(),
      entityType,
      entityId,
      eventType,
      JSON.stringify(payload),
      nowIso(),
    );
  }

  function upsertDocument(id: UUID, title: string, type: string, searchableText: string): void {
    const now = nowIso();
    db.prepare(
      `INSERT INTO documents (id, document_type, title, entity_id, searchable_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         searchable_text = excluded.searchable_text,
         updated_at = excluded.updated_at`,
    ).run(id, type, title, id, searchableText, now, now);
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
      timeline('customer', id, 'Document Created', { displayName: input.displayName });
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
      timeline('customer', id, 'Document Updated', { displayName: input.displayName });
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
      timeline('invoice', id, 'Draft Created', { totals, lineItems: input.lineItems.length });

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
      timeline('invoice', id, 'Draft Updated', { totals, lineItems: input.lineItems.length });

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

      timeline('invoice', id, 'Invoice Finalised', {
        invoiceNumber,
        total: finalised.totals.total,
      });

      return finalised;
    },

    getTimelineForEntity(entityType, entityId) {
      return db
        .prepare(
          `SELECT id, entity_type AS entityType, entity_id AS entityId, event_type AS eventType, event_payload AS eventPayload, created_at AS createdAt
           FROM timeline_events
           WHERE entity_type = ? AND entity_id = ?
           ORDER BY created_at ASC`,
        )
        .all(entityType, entityId);
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

      return { customers, invoices, documents };
    },
  };
}
