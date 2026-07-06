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
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_timeline_entity ON timeline_events(entity_type, entity_id);
