PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_profile (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  legal_name TEXT,
  abn_tax_id TEXT,
  address TEXT,
  email TEXT,
  phone TEXT,
  logo_reference TEXT,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  preference_key TEXT NOT NULL UNIQUE,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  abn_tax_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  searchable_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  notes TEXT,
  payment_terms TEXT,
  invoice_number TEXT,
  status TEXT NOT NULL,
  payment_state TEXT NOT NULL,
  reminder_state TEXT NOT NULL,
  subtotal REAL NOT NULL,
  gst_total REAL NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  gst_applicable INTEGER NOT NULL,
  line_subtotal REAL NOT NULL,
  line_gst REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS invoice_snapshots (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  event_key TEXT,
  event_version INTEGER,
  category TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT,
  source TEXT,
  event_type TEXT NOT NULL,
  event_payload TEXT NOT NULL,
  payload_schema TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_states (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  schedule_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(display_name);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(searchable_text);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number_not_null
ON invoices(invoice_number)
WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_timeline_entity ON timeline_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_key ON timeline_events(event_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_snapshots_invoice_id
ON invoice_snapshots(invoice_id);

CREATE TRIGGER IF NOT EXISTS trg_invoices_finalised_immutable_update
BEFORE UPDATE ON invoices
WHEN OLD.status = 'Finalised'
AND (
  NEW.customer_id <> OLD.customer_id OR
  ifnull(NEW.invoice_number, '') <> ifnull(OLD.invoice_number, '') OR
  NEW.issue_date <> OLD.issue_date OR
  NEW.due_date <> OLD.due_date OR
  ifnull(NEW.notes, '') <> ifnull(OLD.notes, '') OR
  ifnull(NEW.payment_terms, '') <> ifnull(OLD.payment_terms, '') OR
  NEW.subtotal <> OLD.subtotal OR
  NEW.gst_total <> OLD.gst_total OR
  NEW.total <> OLD.total OR
  NEW.status <> OLD.status
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_finalised_immutable_delete
BEFORE DELETE ON invoices
WHEN OLD.status = 'Finalised'
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_line_items_finalised_insert
BEFORE INSERT ON invoice_line_items
WHEN EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = NEW.invoice_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_line_items_finalised_update
BEFORE UPDATE ON invoice_line_items
WHEN EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = OLD.invoice_id AND i.status = 'Finalised'
)
OR EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = NEW.invoice_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_line_items_finalised_delete
BEFORE DELETE ON invoice_line_items
WHEN EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = OLD.invoice_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_snapshots_only_finalised_insert
BEFORE INSERT ON invoice_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = NEW.invoice_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'SNAPSHOT_REQUIRES_FINALISED_INVOICE');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_snapshots_singleton_insert
BEFORE INSERT ON invoice_snapshots
WHEN EXISTS (
  SELECT 1 FROM invoice_snapshots s
  WHERE s.invoice_id = NEW.invoice_id
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INVOICE_SNAPSHOT');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_snapshots_immutable_update
BEFORE UPDATE ON invoice_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INVOICE_SNAPSHOT');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_snapshots_immutable_delete
BEFORE DELETE ON invoice_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INVOICE_SNAPSHOT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_invoice_update
BEFORE UPDATE ON documents
WHEN OLD.document_type = 'invoice'
AND EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = OLD.entity_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_invoice_insert
BEFORE INSERT ON documents
WHEN NEW.document_type = 'invoice'
AND EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = NEW.entity_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_invoice_delete
BEFORE DELETE ON documents
WHEN OLD.document_type = 'invoice'
AND EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.id = OLD.entity_id AND i.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_INVOICE_DOCUMENT');
END;

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
  'preferences.updated'
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_TIMELINE_EVENT_TAXONOMY');
END;
