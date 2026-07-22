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

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  can_be_assigned INTEGER NOT NULL DEFAULT 0,
  can_manage_assignments INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_workspaces (
  id TEXT PRIMARY KEY,
  schema_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_workspace_memberships (
  auth_user_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'owner'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES auth_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_role_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
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

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  notes TEXT,
  terms TEXT,
  quote_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  converted_invoice_id TEXT,
  subtotal REAL NOT NULL,
  gst_total REAL NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (converted_invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  scheduled_start_at TEXT,
  scheduled_end_at TEXT,
  assigned_user_id TEXT,
  assigned_user_name TEXT,
  team_id TEXT,
  completed_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS job_document_links (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (document_id) REFERENCES documents(id)
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

CREATE TABLE IF NOT EXISTS quote_line_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  gst_applicable INTEGER NOT NULL,
  line_subtotal REAL NOT NULL,
  line_gst REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_bills (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  source_purchase_order_id TEXT,
  bill_number TEXT,
  bill_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  supplier_reference TEXT,
  currency TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL,
  payment_state TEXT NOT NULL DEFAULT 'Draft',
  subtotal REAL NOT NULL,
  gst_total REAL NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (source_purchase_order_id) REFERENCES purchase_orders(id)
);

CREATE TABLE IF NOT EXISTS supplier_bill_line_items (
  id TEXT PRIMARY KEY,
  supplier_bill_id TEXT NOT NULL,
  source_purchase_order_line_item_id TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  gst_applicable INTEGER NOT NULL,
  line_subtotal REAL NOT NULL,
  line_gst REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (supplier_bill_id) REFERENCES supplier_bills(id),
  FOREIGN KEY (source_purchase_order_line_item_id) REFERENCES purchase_order_line_items(id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  purchase_order_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  expected_delivery_date TEXT,
  supplier_reference TEXT,
  currency TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL,
  close_reason TEXT,
  closed_date TEXT,
  closed_by TEXT,
  subtotal REAL NOT NULL,
  gst_total REAL NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_order_line_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  gst_applicable INTEGER NOT NULL,
  line_subtotal REAL NOT NULL,
  line_gst REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
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

CREATE TABLE IF NOT EXISTS quote_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY,
  credit_note_number TEXT NOT NULL UNIQUE,
  linked_invoice_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  total_credit REAL NOT NULL,
  line_items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (linked_invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS credit_note_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES customer_payments(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id TEXT PRIMARY KEY,
  supplier_payment_id TEXT NOT NULL,
  supplier_bill_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (supplier_payment_id) REFERENCES supplier_payments(id),
  FOREIGN KEY (supplier_bill_id) REFERENCES supplier_bills(id)
);

CREATE TABLE IF NOT EXISTS payment_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_bill_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payment_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_requests (
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (operation, fingerprint)
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
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(display_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_order ON suppliers(created_at, id);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE INDEX IF NOT EXISTS idx_users_created_order ON users(created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_not_null
ON users(email)
WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_role_links_user ON user_role_links(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_links_role ON user_role_links(role_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_role_links_user_role
ON user_role_links(user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team_created_order
ON team_memberships(team_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_team_user
ON team_memberships(team_id, user_id);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(searchable_text);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_status_issue ON quotes(customer_id, status, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_quotes_status_issue ON quotes(status, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_number ON supplier_bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_status ON supplier_bills(status);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_bill_date ON supplier_bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_due_date ON supplier_bills(due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_bill_date_order ON supplier_bills(bill_date, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bills_supplier_reference_not_null
ON supplier_bills(supplier_id, supplier_reference)
WHERE supplier_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_items_bill ON supplier_bill_line_items(supplier_bill_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_items_source_po_line
ON supplier_bill_line_items(source_purchase_order_line_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_number ON purchase_orders(purchase_order_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_issue_date ON purchase_orders(issue_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_issue_date_order ON purchase_orders(issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_delivery_date ON purchase_orders(expected_delivery_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_supplier_reference_not_null
ON purchase_orders(supplier_id, supplier_reference)
WHERE supplier_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_line_items_order ON purchase_order_line_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_number ON credit_notes(credit_note_number);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON credit_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(linked_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer_issue_order
ON credit_notes(customer_id, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_issue_date
ON credit_notes(linked_invoice_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_customer_payments_number ON customer_payments(payment_number);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_payment_order
ON customer_payments(customer_id, payment_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_payment
ON payment_allocations(invoice_id, payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_payment_invoice
ON payment_allocations(payment_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_number ON supplier_payments(payment_number);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_payment_order
ON supplier_payments(supplier_id, payment_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_payment
ON supplier_payment_allocations(supplier_payment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_bill
ON supplier_payment_allocations(supplier_bill_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_bill_payment
ON supplier_payment_allocations(supplier_bill_id, supplier_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_allocations_payment_bill
ON supplier_payment_allocations(supplier_payment_id, supplier_bill_id);
CREATE INDEX IF NOT EXISTS idx_jobs_number ON jobs(job_number);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
CREATE INDEX IF NOT EXISTS idx_jobs_created_order ON jobs(created_at, id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_start ON jobs(scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_user ON jobs(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_team ON jobs(team_id);
CREATE INDEX IF NOT EXISTS idx_jobs_team_assigned_user ON jobs(team_id, assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_job_document_links_job ON job_document_links(job_id);
CREATE INDEX IF NOT EXISTS idx_job_document_links_job_created_order
ON job_document_links(job_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_job_document_links_document ON job_document_links(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_document_link_pair
ON job_document_links(job_id, document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number_not_null
ON invoices(invoice_number)
WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status_issue_order
ON invoices(customer_id, status, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_issue_order
ON invoices(status, issue_date, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bills_number_not_null
ON supplier_bills(bill_number)
WHERE bill_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_bills_source_po ON supplier_bills(source_purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_source_po_created_order
ON supplier_bills(source_purchase_order_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier_bill_order
ON supplier_bills(supplier_id, bill_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_issue_order
ON purchase_orders(supplier_id, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_issue_order
ON purchase_orders(status, issue_date, created_at, id);
CREATE INDEX IF NOT EXISTS idx_timeline_entity ON timeline_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_timeline_entity_order ON timeline_events(entity_type, entity_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_requests(created_at);
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

CREATE TRIGGER IF NOT EXISTS trg_supplier_bills_finalised_immutable_update
BEFORE UPDATE ON supplier_bills
WHEN OLD.status = 'Finalised'
AND (
  NEW.supplier_id <> OLD.supplier_id OR
  ifnull(NEW.bill_number, '') <> ifnull(OLD.bill_number, '') OR
  NEW.bill_date <> OLD.bill_date OR
  NEW.due_date <> OLD.due_date OR
  ifnull(NEW.supplier_reference, '') <> ifnull(OLD.supplier_reference, '') OR
  NEW.currency <> OLD.currency OR
  ifnull(NEW.notes, '') <> ifnull(OLD.notes, '') OR
  NEW.subtotal <> OLD.subtotal OR
  NEW.gst_total <> OLD.gst_total OR
  NEW.total <> OLD.total OR
  NEW.status <> OLD.status
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_bills_finalised_immutable_delete
BEFORE DELETE ON supplier_bills
WHEN OLD.status = 'Finalised'
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_line_items_finalised_insert
BEFORE INSERT ON supplier_bill_line_items
WHEN EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = NEW.supplier_bill_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_line_items_finalised_update
BEFORE UPDATE ON supplier_bill_line_items
WHEN EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = OLD.supplier_bill_id AND b.status = 'Finalised'
)
OR EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = NEW.supplier_bill_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_line_items_finalised_delete
BEFORE DELETE ON supplier_bill_line_items
WHEN EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = OLD.supplier_bill_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_approved_immutable_update
BEFORE UPDATE ON purchase_orders
WHEN OLD.status = 'Approved'
AND (
  NEW.purchase_order_number <> OLD.purchase_order_number OR
  NEW.supplier_id <> OLD.supplier_id OR
  NEW.issue_date <> OLD.issue_date OR
  ifnull(NEW.expected_delivery_date, '') <> ifnull(OLD.expected_delivery_date, '') OR
  ifnull(NEW.supplier_reference, '') <> ifnull(OLD.supplier_reference, '') OR
  NEW.currency <> OLD.currency OR
  ifnull(NEW.notes, '') <> ifnull(OLD.notes, '') OR
  NEW.subtotal <> OLD.subtotal OR
  NEW.gst_total <> OLD.gst_total OR
  NEW.total <> OLD.total OR
  NEW.status NOT IN ('Approved', 'Closed', 'Cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_APPROVED_PURCHASE_ORDER');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_terminal_immutable_update
BEFORE UPDATE ON purchase_orders
WHEN OLD.status IN ('Closed', 'Cancelled')
AND (
  NEW.purchase_order_number <> OLD.purchase_order_number OR
  NEW.supplier_id <> OLD.supplier_id OR
  NEW.issue_date <> OLD.issue_date OR
  ifnull(NEW.expected_delivery_date, '') <> ifnull(OLD.expected_delivery_date, '') OR
  ifnull(NEW.supplier_reference, '') <> ifnull(OLD.supplier_reference, '') OR
  NEW.currency <> OLD.currency OR
  ifnull(NEW.notes, '') <> ifnull(OLD.notes, '') OR
  NEW.subtotal <> OLD.subtotal OR
  NEW.gst_total <> OLD.gst_total OR
  NEW.total <> OLD.total OR
  NEW.status <> OLD.status
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_TERMINAL_PURCHASE_ORDER');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_number_immutable_update
BEFORE UPDATE ON purchase_orders
WHEN NEW.purchase_order_number <> OLD.purchase_order_number
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PURCHASE_ORDER_NUMBER');
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_notes_number_immutable_update
BEFORE UPDATE ON credit_notes
WHEN NEW.credit_note_number <> OLD.credit_note_number
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CREDIT_NOTE_NUMBER');
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_payments_number_immutable_update
BEFORE UPDATE ON customer_payments
WHEN NEW.payment_number <> OLD.payment_number
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CUSTOMER_PAYMENT_NUMBER');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_payments_number_immutable_update
BEFORE UPDATE ON supplier_payments
WHEN NEW.payment_number <> OLD.payment_number
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SUPPLIER_PAYMENT_NUMBER');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_items_non_draft_insert
BEFORE INSERT ON purchase_order_line_items
WHEN EXISTS (
  SELECT 1 FROM purchase_orders p
  WHERE p.id = NEW.purchase_order_id AND p.status <> 'Draft'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_items_non_draft_update
BEFORE UPDATE ON purchase_order_line_items
WHEN (
  EXISTS (
    SELECT 1 FROM purchase_orders p
    WHERE p.id = OLD.purchase_order_id AND p.status <> 'Draft'
  )
  OR EXISTS (
    SELECT 1 FROM purchase_orders p
    WHERE p.id = NEW.purchase_order_id AND p.status <> 'Draft'
  )
)
AND (
  NEW.id <> OLD.id
  OR NEW.purchase_order_id <> OLD.purchase_order_id
  OR NEW.description <> OLD.description
  OR NEW.quantity <> OLD.quantity
  OR NEW.unit_price <> OLD.unit_price
  OR NEW.gst_applicable <> OLD.gst_applicable
  OR NEW.line_subtotal <> OLD.line_subtotal
  OR NEW.line_gst <> OLD.line_gst
  OR NEW.line_total <> OLD.line_total
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_items_non_draft_delete
BEFORE DELETE ON purchase_order_line_items
WHEN EXISTS (
  SELECT 1 FROM purchase_orders p
  WHERE p.id = OLD.purchase_order_id AND p.status <> 'Draft'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_non_draft_purchase_order_update
BEFORE UPDATE ON documents
WHEN OLD.document_type = 'purchase_order'
AND EXISTS (
  SELECT 1 FROM purchase_orders p
  WHERE p.id = OLD.entity_id AND p.status <> 'Draft'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_non_draft_purchase_order_insert
BEFORE INSERT ON documents
WHEN NEW.document_type = 'purchase_order'
AND EXISTS (
  SELECT 1 FROM purchase_orders p
  WHERE p.id = NEW.entity_id AND p.status <> 'Draft'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_non_draft_purchase_order_delete
BEFORE DELETE ON documents
WHEN OLD.document_type = 'purchase_order'
AND EXISTS (
  SELECT 1 FROM purchase_orders p
  WHERE p.id = OLD.entity_id AND p.status <> 'Draft'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_DOCUMENT');
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

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_supplier_bill_update
BEFORE UPDATE ON documents
WHEN OLD.document_type = 'supplier_bill'
AND EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = OLD.entity_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_supplier_bill_insert
BEFORE INSERT ON documents
WHEN NEW.document_type = 'supplier_bill'
AND EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = NEW.entity_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_finalised_supplier_bill_delete
BEFORE DELETE ON documents
WHEN OLD.document_type = 'supplier_bill'
AND EXISTS (
  SELECT 1 FROM supplier_bills b
  WHERE b.id = OLD.entity_id AND b.status = 'Finalised'
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FINALISED_SUPPLIER_BILL_DOCUMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_customer_reference_immutable_update
BEFORE UPDATE ON invoices
WHEN NEW.customer_id <> OLD.customer_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INVOICE_CUSTOMER_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_notes_customer_reference_immutable_update
BEFORE UPDATE ON credit_notes
WHEN NEW.customer_id <> OLD.customer_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CREDIT_NOTE_CUSTOMER_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_notes_invoice_reference_immutable_update
BEFORE UPDATE ON credit_notes
WHEN NEW.linked_invoice_id <> OLD.linked_invoice_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CREDIT_NOTE_INVOICE_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_payments_customer_reference_immutable_update
BEFORE UPDATE ON customer_payments
WHEN NEW.customer_id <> OLD.customer_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CUSTOMER_PAYMENT_CUSTOMER_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_supplier_reference_immutable_update
BEFORE UPDATE ON purchase_orders
WHEN NEW.supplier_id <> OLD.supplier_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PURCHASE_ORDER_SUPPLIER_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_payments_supplier_reference_immutable_update
BEFORE UPDATE ON supplier_payments
WHEN NEW.supplier_id <> OLD.supplier_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SUPPLIER_PAYMENT_SUPPLIER_REFERENCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_immutable_update
BEFORE UPDATE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PAYMENT_ALLOCATION');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_immutable_delete
BEFORE DELETE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PAYMENT_ALLOCATION');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_payment_allocations_immutable_update
BEFORE UPDATE ON supplier_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SUPPLIER_PAYMENT_ALLOCATION');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_payment_allocations_immutable_delete
BEFORE DELETE ON supplier_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SUPPLIER_PAYMENT_ALLOCATION');
END;


-- Inventory / stock control (schema v45)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT,
  qr_payload TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  brand TEXT,
  supplier_id TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'ea',
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  gst_status TEXT NOT NULL DEFAULT 'gst',
  track_stock INTEGER NOT NULL DEFAULT 1,
  minimum_stock_level REAL NOT NULL DEFAULT 0,
  reorder_quantity REAL NOT NULL DEFAULT 0,
  storage_location TEXT,
  weight REAL,
  length_mm REAL,
  width_mm REAL,
  height_mm REAL,
  image_url TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_bundle INTEGER NOT NULL DEFAULT 0,
  bundle_kind TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode_not_null
ON products(barcode)
WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

CREATE TABLE IF NOT EXISTS inventory_balances (
  product_id TEXT PRIMARY KEY,
  on_hand REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0,
  incoming REAL NOT NULL DEFAULT 0,
  damaged REAL NOT NULL DEFAULT 0,
  returned REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_delta REAL NOT NULL,
  unit_cost REAL,
  bucket TEXT NOT NULL DEFAULT 'on_hand',
  reference_type TEXT,
  reference_id TEXT,
  reference_line_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
ON stock_movements(product_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
ON stock_movements(reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_idempotent
ON stock_movements(product_id, movement_type, reference_type, reference_id, reference_line_id)
WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL AND reference_line_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_bundle_components (
  id TEXT PRIMARY KEY,
  bundle_product_id TEXT NOT NULL,
  component_product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  FOREIGN KEY (bundle_product_id) REFERENCES products(id),
  FOREIGN KEY (component_product_id) REFERENCES products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_component
ON product_bundle_components(bundle_product_id, component_product_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  notes TEXT,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
);

CREATE TABLE IF NOT EXISTS goods_receipt_line_items (
  id TEXT PRIMARY KEY,
  goods_receipt_id TEXT NOT NULL,
  purchase_order_line_item_id TEXT NOT NULL,
  product_id TEXT,
  quantity_received REAL NOT NULL,
  FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id),
  FOREIGN KEY (purchase_order_line_item_id) REFERENCES purchase_order_line_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id TEXT PRIMARY KEY,
  stocktake_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  started_at TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stocktake_lines (
  id TEXT PRIMARY KEY,
  stocktake_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  expected_quantity REAL NOT NULL,
  counted_quantity REAL,
  notes TEXT,
  FOREIGN KEY (stocktake_id) REFERENCES stocktakes(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stocktake_product
ON stocktake_lines(stocktake_id, product_id);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  suggested_reorder_quantity REAL,
  is_dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_alerts_open
ON inventory_alerts(is_dismissed, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_product
ON inventory_alerts(product_id, is_dismissed, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type_created
ON stock_movements(movement_type, created_at, id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_purchase_order
ON goods_receipts(purchase_order_id, received_at, id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt
ON goods_receipt_line_items(goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_po_line
ON goods_receipt_line_items(purchase_order_line_item_id);
CREATE INDEX IF NOT EXISTS idx_stocktakes_status_created
ON stocktakes(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_product
ON stocktake_lines(product_id);

CREATE TABLE IF NOT EXISTS job_materials (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  notes TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_material_product
ON job_materials(job_id, product_id);

CREATE TABLE IF NOT EXISTS goods_receipt_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stocktake_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_immutable_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STOCK_MOVEMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_immutable_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STOCK_MOVEMENT');
END;

-- Slice 54: Accounting foundations (Chart of Accounts, periods, journals, audit)

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  account_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  category TEXT NOT NULL,
  gst_default TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_years (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id TEXT PRIMARY KEY,
  financial_year_id TEXT NOT NULL,
  label TEXT NOT NULL,
  period_number INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (financial_year_id) REFERENCES financial_years(id),
  UNIQUE (financial_year_id, period_number)
);

CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  journal_number TEXT UNIQUE,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  journal_date TEXT NOT NULL,
  period_id TEXT,
  narration TEXT NOT NULL,
  notes TEXT,
  reference TEXT,
  created_by_user_id TEXT,
  approved_by_user_id TEXT,
  posted_by_user_id TEXT,
  reversed_by_journal_id TEXT,
  reverses_journal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  posted_at TEXT,
  FOREIGN KEY (period_id) REFERENCES accounting_periods(id)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  gst_amount REAL,
  gst_code TEXT,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

CREATE TABLE IF NOT EXISTS journal_attachments (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_audit_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_address TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_sequence INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coa_type_active
ON chart_of_accounts(account_type, is_active, is_archived, account_number);
CREATE INDEX IF NOT EXISTS idx_periods_year_status
ON accounting_periods(financial_year_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_journals_date_status
ON journals(journal_date, status, journal_number);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account
ON journal_lines(account_id, journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal
ON journal_lines(journal_id, line_number);
CREATE INDEX IF NOT EXISTS idx_accounting_audit_entity
ON accounting_audit_events(entity_type, entity_id, created_at);
