import { z } from 'zod';

export const BANK_ACCOUNT_TYPES = [
  'business_cheque',
  'savings',
  'trust',
  'cash',
  'paypal',
  'credit_card',
] as const;

export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const BANK_FEED_SOURCES = [
  'manual',
  'csv',
  'ofx',
  'qif',
  'open_banking',
  'stripe',
  'square',
  'paypal',
] as const;

export type BankFeedSource = (typeof BANK_FEED_SOURCES)[number];

export const BANK_TRANSACTION_STATUSES = [
  'unmatched',
  'suggested',
  'matched',
  'ignored',
] as const;

export type BankTransactionStatus = (typeof BANK_TRANSACTION_STATUSES)[number];

export const MATCH_CONFIDENCE_BANDS = ['high', 'medium', 'low'] as const;
export type MatchConfidenceBand = (typeof MATCH_CONFIDENCE_BANDS)[number];

export const MATCH_METHODS = [
  'invoice_number',
  'reference',
  'exact_amount',
  'customer_name',
  'partial_amount',
  'composite',
  'manual',
] as const;

export type MatchMethod = (typeof MATCH_METHODS)[number];

export const RECONCILIATION_ACTIONS = [
  'import',
  'auto_match',
  'suggest_match',
  'approve_match',
  'manual_match',
  'unmatch',
  'ignore',
  'edit_payment',
  'delete_payment',
] as const;

export type ReconciliationAction = (typeof RECONCILIATION_ACTIONS)[number];

export interface MatchCandidateScore {
  invoiceNumber: number;
  reference: number;
  amount: number;
  customerName: number;
  description: number;
  date: number;
  outstanding: number;
}

/** Minimal transaction shape used by the matching engine. */
export interface ParsedBankTransactionLike {
  bookedDate: string;
  amount: number;
  description: string | null;
  reference: string | null;
  counterpartyName: string | null;
}

export interface BankAccount {
  id: string;
  nickname: string;
  accountType: BankAccountType;
  institution: string | null;
  accountNumberMasked: string | null;
  bsbMasked: string | null;
  currency: string;
  balance: number;
  lastSyncAt: string | null;
  source: BankFeedSource;
  status: 'active' | 'archived';
  /** Reserved for Open Banking / Stripe / Square account linkage */
  externalAccountId: string | null;
  connectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  externalFingerprint: string;
  bookedDate: string;
  amount: number;
  description: string | null;
  reference: string | null;
  counterpartyName: string | null;
  balanceAfter: number | null;
  bsb: string | null;
  accountNumber: string | null;
  rawPayload: Record<string, unknown> | null;
  status: BankTransactionStatus;
  importBatchId: string | null;
  sourceFormat: 'csv' | 'ofx' | 'qif' | 'manual' | 'feed';
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationMatchAllocation {
  invoiceId: string;
  invoiceNumber?: string | undefined;
  amount: number;
}

export interface ReconciliationMatch {
  id: string;
  bankTransactionId: string;
  bankAccountId: string;
  customerId: string | null;
  customerPaymentId: string | null;
  confidence: number;
  confidenceBand: MatchConfidenceBand;
  matchMethod: MatchMethod | string;
  status: 'suggested' | 'confirmed' | 'rejected';
  rationale: string[];
  scores: MatchCandidateScore | Record<string, number>;
  allocations: ReconciliationMatchAllocation[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface ReconciliationAuditEntry {
  id: string;
  action: ReconciliationAction;
  entityType: string;
  entityId: string;
  bankTransactionId: string | null;
  matchId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  originalValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
}

export interface StatementImportResult {
  importBatchId: string;
  imported: number;
  duplicates: number;
  autoMatched: number;
  suggested: number;
  unmatched: number;
  warnings: string[];
  transactions: BankTransaction[];
}

export interface ReconciliationWorkspace {
  accounts: BankAccount[];
  transactions: BankTransaction[];
  matches: ReconciliationMatch[];
  summary: {
    unmatched: number;
    suggested: number;
    matched: number;
    ignored: number;
  };
}

export interface ReconciliationReport {
  outstandingInvoices: Array<{
    invoiceId: string;
    invoiceNumber: string;
    customerId: string;
    customerName: string;
    dueDate: string;
    outstanding: number;
  }>;
  unmatchedPayments: BankTransaction[];
  reconciliationHistory: ReconciliationAuditEntry[];
  cashReceived: {
    total: number;
    byDay: Array<{ date: string; amount: number; count: number }>;
  };
  dailyBankingSummary: Array<{
    date: string;
    credits: number;
    debits: number;
    matched: number;
    unmatched: number;
  }>;
  paymentAging: Array<{
    bucket: string;
    count: number;
    amount: number;
  }>;
}

export const createBankAccountSchema = z.object({
  nickname: z.string().trim().min(1).max(120),
  accountType: z.enum(BANK_ACCOUNT_TYPES).default('business_cheque'),
  institution: z.string().trim().max(160).nullable().optional(),
  accountNumberMasked: z.string().trim().max(40).nullable().optional(),
  bsbMasked: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().length(3).default('AUD'),
  balance: z.number().default(0),
  source: z.enum(BANK_FEED_SOURCES).default('manual'),
  externalAccountId: z.string().trim().max(200).nullable().optional(),
  connectionId: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateBankAccountSchema = createBankAccountSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
  lastSyncAt: z.string().datetime().nullable().optional(),
});

export const importBankStatementSchema = z.object({
  bankAccountId: z.string().uuid(),
  format: z.enum(['csv', 'ofx', 'qif']),
  filename: z.string().trim().min(1).max(260),
  contentBase64: z.string().min(1).max(8_000_000),
  autoMatch: z.boolean().default(true),
});

export const manualMatchSchema = z.object({
  bankTransactionId: z.string().uuid(),
  customerId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    )
    .min(1),
  paymentMethod: z.string().min(1).default('Bank Transfer'),
  reference: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

export const approveMatchSchema = z.object({
  matchId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    )
    .min(1)
    .optional(),
});

export const bulkMatchIdsSchema = z.object({
  matchIds: z.array(z.string().uuid()).min(1).max(200),
});

export const bulkTransactionIdsSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(200),
});

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;
export const MATCH_CONFIDENCE_HIGH = HIGH_CONFIDENCE_THRESHOLD;
export const MATCH_CONFIDENCE_MEDIUM = MEDIUM_CONFIDENCE_THRESHOLD;

export function confidenceBand(score: number): MatchConfidenceBand {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

export function mapBankAccountRow(row: Record<string, unknown>): BankAccount {
  return {
    id: String(row.id),
    nickname: String(row.nickname),
    accountType: z.enum(BANK_ACCOUNT_TYPES).parse(row.account_type),
    institution: row.institution ? String(row.institution) : null,
    accountNumberMasked: row.account_number_masked ? String(row.account_number_masked) : null,
    bsbMasked: row.bsb_masked ? String(row.bsb_masked) : null,
    currency: String(row.currency ?? 'AUD'),
    balance: Number(row.balance ?? 0),
    lastSyncAt: (row.last_sync_at as string | null) ?? null,
    source: z.enum(BANK_FEED_SOURCES).catch('manual').parse(row.source ?? 'manual'),
    status: row.status === 'archived' ? 'archived' : 'active',
    externalAccountId: row.external_account_id ? String(row.external_account_id) : null,
    connectionId: row.connection_id ? String(row.connection_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapBankTransactionRow(row: Record<string, unknown>): BankTransaction {
  return {
    id: String(row.id),
    bankAccountId: String(row.bank_account_id),
    externalFingerprint: String(row.external_fingerprint),
    bookedDate: String(row.booked_date).slice(0, 10),
    amount: Number(row.amount),
    description: row.description ? String(row.description) : null,
    reference: row.reference ? String(row.reference) : null,
    counterpartyName: row.counterparty_name ? String(row.counterparty_name) : null,
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    bsb: row.bsb ? String(row.bsb) : null,
    accountNumber: row.account_number ? String(row.account_number) : null,
    rawPayload: parseJsonObject(row.raw_payload_json),
    status: z.enum(BANK_TRANSACTION_STATUSES).catch('unmatched').parse(row.status),
    importBatchId: (row.import_batch_id as string | null) ?? null,
    sourceFormat: z
      .enum(['csv', 'ofx', 'qif', 'manual', 'feed'])
      .catch('manual')
      .parse(row.source_format ?? 'manual'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapReconciliationMatchRow(row: Record<string, unknown>): ReconciliationMatch {
  const allocations = parseJsonArray(row.allocations_json).map((item) => {
    const alloc = item as Record<string, unknown>;
    return {
      invoiceId: String(alloc.invoiceId ?? alloc.invoice_id),
      invoiceNumber:
        alloc.invoiceNumber != null || alloc.invoice_number != null
          ? String(alloc.invoiceNumber ?? alloc.invoice_number)
          : undefined,
      amount: Number(alloc.amount),
    };
  });
  return {
    id: String(row.id),
    bankTransactionId: String(row.bank_transaction_id),
    bankAccountId: String(row.bank_account_id),
    customerId: (row.customer_id as string | null) ?? null,
    customerPaymentId: (row.customer_payment_id as string | null) ?? null,
    confidence: Number(row.confidence ?? 0),
    confidenceBand: z.enum(MATCH_CONFIDENCE_BANDS).catch('low').parse(row.confidence_band),
    matchMethod: String(row.match_method ?? 'composite'),
    status: z.enum(['suggested', 'confirmed', 'rejected']).catch('suggested').parse(row.status),
    rationale: z.array(z.string()).catch([]).parse(parseJsonArray(row.rationale_json)),
    scores: (parseJsonObject(row.scores_json) ?? {}) as unknown as MatchCandidateScore,
    allocations,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
  };
}

export function mapReconciliationAuditRow(row: Record<string, unknown>): ReconciliationAuditEntry {
  return {
    id: String(row.id),
    action: z.enum(RECONCILIATION_ACTIONS).catch('import').parse(row.action),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    bankTransactionId: (row.bank_transaction_id as string | null) ?? null,
    matchId: (row.match_id as string | null) ?? null,
    actorUserId: (row.user_id as string | null) ?? null,
    actorEmail: (row.user_email as string | null) ?? null,
    originalValues: parseJsonObject(row.original_values_json),
    newValues: parseJsonObject(row.new_values_json),
    createdAt: String(row.created_at),
  };
}
