/** Extended job scheduling tables (SQLite). */

export const JOBS_EXTENSION_SQLITE = `
ALTER TABLE jobs ADD COLUMN site_address TEXT;
ALTER TABLE jobs ADD COLUMN suburb TEXT;
ALTER TABLE jobs ADD COLUMN contact_person TEXT;
ALTER TABLE jobs ADD COLUMN contact_phone TEXT;
ALTER TABLE jobs ADD COLUMN internal_notes TEXT;
ALTER TABLE jobs ADD COLUMN customer_notes TEXT;
ALTER TABLE jobs ADD COLUMN colour TEXT;
ALTER TABLE jobs ADD COLUMN quote_id TEXT;
ALTER TABLE jobs ADD COLUMN invoice_id TEXT;
ALTER TABLE jobs ADD COLUMN latitude REAL;
ALTER TABLE jobs ADD COLUMN longitude REAL;
ALTER TABLE jobs ADD COLUMN estimated_travel_minutes INTEGER;

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
CREATE INDEX IF NOT EXISTS idx_job_suburb ON jobs(suburb);
CREATE INDEX IF NOT EXISTS idx_job_notifications_job ON job_notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_portal_token ON customer_portal_tokens(token);
`;

export const JOBS_EXTENSION_TABLE_NAMES = [
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
