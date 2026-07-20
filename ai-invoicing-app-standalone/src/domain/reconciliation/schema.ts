/** SQL fragments for bank reconciliation tables. */

export const RECONCILIATION_SQLITE_TABLES = `
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  account_type TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  account_number_masked TEXT NOT NULL DEFAULT '',
  bsb_masked TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AUD',
  balance REAL NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  external_account_id TEXT,
  connection_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  external_fingerprint TEXT NOT NULL,
  external_id TEXT,
  booked_date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  counterparty_name TEXT NOT NULL DEFAULT '',
  balance_after REAL,
  bsb TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  source_format TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bank_account_id, external_fingerprint),
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
);

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  confidence REAL NOT NULL DEFAULT 0,
  confidence_band TEXT NOT NULL DEFAULT 'low',
  match_method TEXT NOT NULL DEFAULT 'composite',
  rationale_json TEXT NOT NULL DEFAULT '[]',
  scores_json TEXT NOT NULL DEFAULT '{}',
  allocations_json TEXT NOT NULL DEFAULT '[]',
  customer_payment_id TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id),
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
);

CREATE TABLE IF NOT EXISTS reconciliation_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  bank_transaction_id TEXT,
  match_id TEXT,
  user_id TEXT,
  user_email TEXT,
  original_values_json TEXT NOT NULL DEFAULT '{}',
  new_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(booked_date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_fingerprint ON bank_transactions(external_fingerprint);
CREATE INDEX IF NOT EXISTS idx_recon_match_txn ON reconciliation_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_recon_match_status ON reconciliation_matches(status);
CREATE INDEX IF NOT EXISTS idx_recon_audit_created ON reconciliation_audit(created_at);
`;

export const RECONCILIATION_PG_TABLES = `
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  account_type TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  account_number_masked TEXT NOT NULL DEFAULT '',
  bsb_masked TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AUD',
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  external_account_id TEXT,
  connection_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  external_fingerprint TEXT NOT NULL,
  external_id TEXT,
  booked_date DATE NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  counterparty_name TEXT NOT NULL DEFAULT '',
  balance_after DOUBLE PRECISION,
  bsb TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  source_format TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(bank_account_id, external_fingerprint)
);

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence_band TEXT NOT NULL DEFAULT 'low',
  match_method TEXT NOT NULL DEFAULT 'composite',
  rationale_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  allocations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_payment_id TEXT,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  bank_transaction_id TEXT,
  match_id TEXT,
  user_id TEXT,
  user_email TEXT,
  original_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(booked_date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_fingerprint ON bank_transactions(external_fingerprint);
CREATE INDEX IF NOT EXISTS idx_recon_match_txn ON reconciliation_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_recon_match_status ON reconciliation_matches(status);
CREATE INDEX IF NOT EXISTS idx_recon_audit_created ON reconciliation_audit(created_at);
`;

export const RECONCILIATION_TABLE_NAMES = [
  'bank_accounts',
  'bank_transactions',
  'reconciliation_matches',
  'reconciliation_audit',
] as const;
