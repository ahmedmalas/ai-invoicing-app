import { randomUUID } from 'node:crypto';
import {
  mapBankAccountRow,
  mapBankTransactionRow,
  mapReconciliationAuditRow,
  mapReconciliationMatchRow,
  scoreTransactionMatches,
  selectAutoAllocations,
  transactionFingerprint,
  parseBankStatement,
  type BankAccount,
  type BankTransaction,
  type MatchableInvoice,
  type MatchCandidateScore,
  type ReconciliationAuditEntry,
  type ReconciliationMatch,
  type ReconciliationReport,
  type ReconciliationWorkspace,
  type StatementImportResult,
} from '../domain/reconciliation/index.js';
import type { CustomerPayment } from '../types/entities.js';

export type { BankAccount, BankTransaction, ReconciliationMatch, StatementImportResult };

export type CreateBankAccountInput = {
  nickname: string;
  accountType: BankAccount['accountType'];
  institution?: string | null | undefined;
  accountNumberMasked?: string | null | undefined;
  bsbMasked?: string | null | undefined;
  currency?: string | undefined;
  balance?: number | undefined;
  source?: BankAccount['source'] | undefined;
  externalAccountId?: string | null | undefined;
  connectionId?: string | null | undefined;
  notes?: string | null | undefined;
};

export type UpdateBankAccountInput = {
  nickname?: string | undefined;
  accountType?: BankAccount['accountType'] | undefined;
  institution?: string | null | undefined;
  accountNumberMasked?: string | null | undefined;
  bsbMasked?: string | null | undefined;
  currency?: string | undefined;
  balance?: number | undefined;
  source?: BankAccount['source'] | undefined;
  externalAccountId?: string | null | undefined;
  connectionId?: string | null | undefined;
  status?: 'active' | 'archived' | undefined;
  lastSyncAt?: string | null | undefined;
};

export type CreateCustomerPaymentInput = {
  customerId: string;
  paymentDate: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  notes?: string;
  allocations: Array<{ invoiceId: string; amount: number }>;
};

export interface ReconciliationActor {
  userId?: string | null;
  email?: string | null;
}

export interface PostgresReconciliationDb {
  prepare(sql: string): {
    get: (...values: unknown[]) => Promise<unknown>;
    all: (...values: unknown[]) => Promise<unknown[]>;
    run: (...values: unknown[]) => Promise<void>;
  };
}

export interface PostgresReconciliationStoreDeps {
  db: PostgresReconciliationDb;
  nowIso: () => string;
  createCustomerPayment: (input: CreateCustomerPaymentInput) => Promise<CustomerPayment>;
  timeline: (eventKey: string, entityId: string, payload: unknown) => Promise<void>;
  listOpenInvoiceCandidates: () => Promise<MatchableInvoice[]>;
  withTransaction: <T>(work: () => Promise<T>) => Promise<T>;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function createPostgresReconciliationStore(deps: PostgresReconciliationStoreDeps) {
  const { db, nowIso, createCustomerPayment, timeline, listOpenInvoiceCandidates, withTransaction } = deps;

  async function writeAudit(input: {
    action: ReconciliationAuditEntry['action'];
    entityType: string;
    entityId: string;
    bankTransactionId?: string | null | undefined;
    matchId?: string | null | undefined;
    actor?: ReconciliationActor | undefined;
    originalValues?: Record<string, unknown> | null | undefined;
    newValues?: Record<string, unknown> | null | undefined;
  }): Promise<void> {
    await db.prepare(
      `INSERT INTO reconciliation_audit (
        id, action, entity_type, entity_id, bank_transaction_id, match_id,
        user_id, user_email, original_values_json, new_values_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.action,
      input.entityType,
      input.entityId,
      input.bankTransactionId ?? null,
      input.matchId ?? null,
      input.actor?.userId ?? null,
      input.actor?.email ?? null,
      json(input.originalValues ?? {}),
      json(input.newValues ?? {}),
      nowIso(),
    );
  }

  async function getBankAccountById(id: string): Promise<BankAccount | null> {
    const row = await (db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id)) as
      | Record<string, unknown>
      | undefined;
    return row ? mapBankAccountRow(row) : null;
  }

  async function listBankAccounts(): Promise<BankAccount[]> {
    const rows = await db
      .prepare('SELECT * FROM bank_accounts ORDER BY lower(nickname) ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapBankAccountRow);
  }

  async function createBankAccount(input: CreateBankAccountInput): Promise<BankAccount> {
    const id = randomUUID();
    const now = nowIso();
    await db.prepare(
      `INSERT INTO bank_accounts (
        id, nickname, account_type, institution, account_number_masked, bsb_masked,
        currency, balance, last_sync_at, source, status, external_account_id, connection_id,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nickname,
      input.accountType,
      input.institution ?? '',
      input.accountNumberMasked ?? '',
      input.bsbMasked ?? '',
      input.currency ?? 'AUD',
      input.balance ?? 0,
      input.source ?? 'manual',
      input.externalAccountId ?? null,
      input.connectionId ?? null,
      input.notes ?? '',
      now,
      now,
    );
    await writeAudit({
      action: 'import',
      entityType: 'bank_account',
      entityId: id,
      newValues: { nickname: input.nickname, accountType: input.accountType },
    });
    return (await getBankAccountById(id))!;
  }

  async function updateBankAccount(id: string, input: UpdateBankAccountInput): Promise<BankAccount> {
    const existing = await getBankAccountById(id);
    if (!existing) throw new Error('BANK_ACCOUNT_NOT_FOUND');
    const now = nowIso();
    await db.prepare(
      `UPDATE bank_accounts SET
        nickname = ?,
        account_type = ?,
        institution = ?,
        account_number_masked = ?,
        bsb_masked = ?,
        currency = ?,
        balance = ?,
        last_sync_at = ?,
        source = ?,
        status = ?,
        external_account_id = ?,
        connection_id = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      input.nickname ?? existing.nickname,
      input.accountType ?? existing.accountType,
      input.institution ?? existing.institution ?? '',
      input.accountNumberMasked ?? existing.accountNumberMasked ?? '',
      input.bsbMasked ?? existing.bsbMasked ?? '',
      input.currency ?? existing.currency,
      input.balance ?? existing.balance,
      input.lastSyncAt !== undefined ? input.lastSyncAt : existing.lastSyncAt,
      input.source ?? existing.source,
      input.status ?? existing.status,
      input.externalAccountId !== undefined
        ? input.externalAccountId
        : existing.externalAccountId,
      input.connectionId !== undefined ? input.connectionId : existing.connectionId,
      now,
      id,
    );
    return (await getBankAccountById(id))!;
  }

  async function getBankTransactionById(id: string): Promise<BankTransaction | null> {
    const row = await (db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id)) as
      | Record<string, unknown>
      | undefined;
    return row ? mapBankTransactionRow(row) : null;
  }

  async function listBankTransactions(filter?: {
    bankAccountId?: string;
    status?: string;
    search?: string;
    importBatchId?: string;
  }): Promise<BankTransaction[]> {
    const rows = await db
      .prepare(
        `SELECT * FROM bank_transactions
         WHERE (? IS NULL OR bank_account_id = ?)
           AND (? IS NULL OR status = ?)
           AND (? IS NULL OR import_batch_id = ?)
           AND (
             ? IS NULL OR
             lower(description) LIKE ? OR
             lower(reference) LIKE ? OR
             lower(counterparty_name) LIKE ?
           )
         ORDER BY booked_date DESC, created_at DESC`,
      )
      .all(
        filter?.bankAccountId ?? null,
        filter?.bankAccountId ?? null,
        filter?.status ?? null,
        filter?.status ?? null,
        filter?.importBatchId ?? null,
        filter?.importBatchId ?? null,
        filter?.search ? `%${filter.search.toLowerCase()}%` : null,
        filter?.search ? `%${filter.search.toLowerCase()}%` : null,
        filter?.search ? `%${filter.search.toLowerCase()}%` : null,
        filter?.search ? `%${filter.search.toLowerCase()}%` : null,
      ) as Array<Record<string, unknown>>;
    return rows.map(mapBankTransactionRow);
  }

  async function getMatchById(id: string): Promise<ReconciliationMatch | null> {
    const row = await (db.prepare('SELECT * FROM reconciliation_matches WHERE id = ?').get(id)) as
      | Record<string, unknown>
      | undefined;
    return row ? mapReconciliationMatchRow(row) : null;
  }

  async function listMatches(filter?: {
    bankTransactionId?: string;
    status?: string;
    bankAccountId?: string;
  }): Promise<ReconciliationMatch[]> {
    const rows = await db
      .prepare(
        `SELECT * FROM reconciliation_matches
         WHERE (? IS NULL OR bank_transaction_id = ?)
           AND (? IS NULL OR status = ?)
           AND (? IS NULL OR bank_account_id = ?)
         ORDER BY confidence DESC, created_at DESC`,
      )
      .all(
        filter?.bankTransactionId ?? null,
        filter?.bankTransactionId ?? null,
        filter?.status ?? null,
        filter?.status ?? null,
        filter?.bankAccountId ?? null,
        filter?.bankAccountId ?? null,
      ) as Array<Record<string, unknown>>;
    return rows.map(mapReconciliationMatchRow);
  }

  async function insertMatch(input: {
    bankTransactionId: string;
    bankAccountId: string;
    customerId: string | null;
    status: 'suggested' | 'confirmed' | 'rejected';
    confidence: number;
    confidenceBand: string;
    matchMethod: string;
    rationale: string[];
    scores: Record<string, number> | MatchCandidateScore;
    allocations: Array<{ invoiceId: string; invoiceNumber?: string; amount: number }>;
    customerPaymentId?: string | null;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
  }): Promise<ReconciliationMatch> {
    const id = randomUUID();
    const now = nowIso();
    await db.prepare(
      `INSERT INTO reconciliation_matches (
        id, bank_transaction_id, bank_account_id, customer_id, status, confidence,
        confidence_band, match_method, rationale_json, scores_json, allocations_json,
        customer_payment_id, confirmed_by, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.bankTransactionId,
      input.bankAccountId,
      input.customerId,
      input.status,
      input.confidence,
      input.confidenceBand,
      input.matchMethod,
      json(input.rationale),
      json(input.scores),
      json(input.allocations),
      input.customerPaymentId ?? null,
      input.confirmedBy ?? null,
      input.confirmedAt ?? null,
      now,
      now,
    );
    return (await getMatchById(id))!;
  }

  async function confirmMatchWithPayment(
    match: ReconciliationMatch,
    txn: BankTransaction,
    allocations: Array<{ invoiceId: string; amount: number }>,
    actor: ReconciliationActor | undefined,
    action: 'auto_match' | 'approve_match' | 'manual_match',
    paymentMethod = 'Bank Transfer',
    reference?: string,
    notes?: string,
  ): Promise<{ match: ReconciliationMatch; payment: CustomerPayment }> {
    if (allocations.length === 0) throw new Error('RECONCILIATION_ALLOCATIONS_REQUIRED');
    const customerId = match.customerId;
    if (!customerId) throw new Error('RECONCILIATION_CUSTOMER_REQUIRED');

    const amount = allocations.reduce((sum, a) => sum + a.amount, 0);
    if (amount <= 0) throw new Error('RECONCILIATION_AMOUNT_INVALID');
    if (amount - txn.amount > 0.005) throw new Error('RECONCILIATION_ALLOCATIONS_EXCEED_TXN');

    const payment = await createCustomerPayment({
      customerId,
      paymentDate: txn.bookedDate,
      paymentMethod,
      reference:
        reference ||
        txn.reference ||
        `BANK-${txn.id.slice(0, 8)}`,
      amount: Math.round(amount * 100) / 100,
      notes: notes ?? `Reconciled from bank transaction ${txn.id}`,
      allocations,
    });

    const now = nowIso();
    await db.prepare(
      `UPDATE reconciliation_matches SET
        status = 'confirmed',
        customer_payment_id = ?,
        allocations_json = ?,
        confirmed_by = ?,
        confirmed_at = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(payment.id, json(allocations), actor?.userId ?? null, now, now, match.id);

    await db.prepare(
      `UPDATE bank_transactions SET status = 'matched', updated_at = ? WHERE id = ?`,
    ).run(now, txn.id);

    // Reject sibling suggestions for this transaction
    await db.prepare(
      `UPDATE reconciliation_matches SET status = 'rejected', updated_at = ?
       WHERE bank_transaction_id = ? AND id <> ? AND status = 'suggested'`,
    ).run(now, txn.id, match.id);

    await writeAudit({
      action,
      entityType: 'reconciliation_match',
      entityId: match.id,
      bankTransactionId: txn.id,
      matchId: match.id,
      actor,
      originalValues: { status: match.status },
      newValues: {
        status: 'confirmed',
        customerPaymentId: payment.id,
        allocations,
      },
    });

    await timeline('reconciliation.matched', txn.id, {
      matchId: match.id,
      paymentId: payment.id,
      action,
      confidence: match.confidence,
      allocations,
    });

    const confirmedMatch = (await getMatchById(match.id))!;
    return { match: confirmedMatch, payment };
  }

  async function runMatchingForTransaction(
    txn: BankTransaction,
    autoApply: boolean,
    actor?: ReconciliationActor,
  ): Promise<{ autoMatched: boolean; suggested: boolean }> {
    if (txn.amount <= 0) {
      return { autoMatched: false, suggested: false };
    }

    const candidates = await listOpenInvoiceCandidates();
    const suggestions = scoreTransactionMatches(txn, candidates);
    if (suggestions.length === 0) {
      return { autoMatched: false, suggested: false };
    }

    const autoAllocations = autoApply ? selectAutoAllocations(txn.amount, suggestions) : [];
    if (autoAllocations.length > 0) {
      const primary = autoAllocations[0]!;
      const match = await insertMatch({
        bankTransactionId: txn.id,
        bankAccountId: txn.bankAccountId,
        customerId: primary.customerId,
        status: 'suggested',
        confidence: primary.confidence,
        confidenceBand: primary.confidenceBand,
        matchMethod: primary.matchMethod,
        rationale: primary.reasons,
        scores: primary.scores,
        allocations: autoAllocations.map((s) => ({
          invoiceId: s.invoiceId,
          invoiceNumber: s.invoiceNumber,
          amount: s.amount,
        })),
      });

      await confirmMatchWithPayment(
        match,
        txn,
        autoAllocations.map((s) => ({ invoiceId: s.invoiceId, amount: s.amount })),
        actor,
        'auto_match',
      );
      return { autoMatched: true, suggested: false };
    }

    // Store top suggestions (medium/high) for review — one match row per top candidate group
    const reviewable = suggestions.filter((s) => s.confidenceBand !== 'low').slice(0, 5);
    if (reviewable.length === 0) {
      return { autoMatched: false, suggested: false };
    }

    const best = reviewable[0]!;
    await insertMatch({
      bankTransactionId: txn.id,
      bankAccountId: txn.bankAccountId,
      customerId: best.customerId,
      status: 'suggested',
      confidence: best.confidence,
      confidenceBand: best.confidenceBand,
      matchMethod: best.matchMethod,
      rationale: best.reasons,
      scores: best.scores,
      allocations: reviewable.map((s) => ({
        invoiceId: s.invoiceId,
        invoiceNumber: s.invoiceNumber,
        amount: s.amount,
      })),
    });

    // Also store alternate suggestions as separate rows for UI
    for (const alt of reviewable.slice(1, 3)) {
      await insertMatch({
        bankTransactionId: txn.id,
        bankAccountId: txn.bankAccountId,
        customerId: alt.customerId,
        status: 'suggested',
        confidence: alt.confidence,
        confidenceBand: alt.confidenceBand,
        matchMethod: alt.matchMethod,
        rationale: alt.reasons,
        scores: alt.scores,
        allocations: [
          { invoiceId: alt.invoiceId, invoiceNumber: alt.invoiceNumber, amount: alt.amount },
        ],
      });
    }

    await db.prepare(
      `UPDATE bank_transactions SET status = 'suggested', updated_at = ? WHERE id = ?`,
    ).run(nowIso(), txn.id);

    await writeAudit({
      action: 'suggest_match',
      entityType: 'bank_transaction',
      entityId: txn.id,
      bankTransactionId: txn.id,
      actor,
      newValues: {
        suggestionCount: reviewable.length,
        topConfidence: best.confidence,
      },
    });

    await timeline('reconciliation.suggested', txn.id, {
      suggestionCount: reviewable.length,
      topConfidence: best.confidence,
    });

    return { autoMatched: false, suggested: true };
  }

  async function importBankStatement(input: {
    bankAccountId: string;
    format: 'csv' | 'ofx' | 'qif';
    filename: string;
    content: string;
    autoMatch?: boolean;
    actor?: ReconciliationActor;
  }): Promise<StatementImportResult> {
    const account = await getBankAccountById(input.bankAccountId);
    if (!account) throw new Error('BANK_ACCOUNT_NOT_FOUND');

    const parsed = parseBankStatement(input.format, input.content);
    const importBatchId = randomUUID();
    const now = nowIso();
    let imported = 0;
    let duplicates = 0;
    let autoMatched = 0;
    let suggested = 0;
    const created: BankTransaction[] = [];

    const insertTxn = await db.prepare(
      `INSERT INTO bank_transactions (
        id, bank_account_id, external_fingerprint, external_id, booked_date, amount,
        description, reference, counterparty_name, balance_after, bsb, account_number,
        source_format, import_batch_id, status, raw_payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?, ?, ?)`,
    );

    for (const txn of parsed.transactions) {
      const fingerprint = transactionFingerprint(input.bankAccountId, txn);
      const existing = await db
        .prepare(
          `SELECT id FROM bank_transactions
           WHERE bank_account_id = ? AND external_fingerprint = ?`,
        )
        .get(input.bankAccountId, fingerprint);
      if (existing) {
        duplicates += 1;
        continue;
      }

      const id = randomUUID();
      try {
        insertTxn.run(
          id,
          input.bankAccountId,
          fingerprint,
          txn.bookedDate,
          txn.amount,
          txn.description ?? '',
          txn.reference ?? '',
          txn.counterpartyName ?? '',
          txn.balanceAfter,
          txn.bsb ?? '',
          txn.accountNumber ?? '',
          input.format,
          importBatchId,
          json(txn.raw),
          now,
          now,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('UNIQUE') || message.includes('unique')) {
          duplicates += 1;
          continue;
        }
        throw error;
      }

      imported += 1;
      const createdTxn = (await getBankTransactionById(id))!;
      created.push(createdTxn);

      if (input.autoMatch !== false && createdTxn.amount > 0) {
        const result = await runMatchingForTransaction(createdTxn, true, input.actor);
        if (result.autoMatched) autoMatched += 1;
        else if (result.suggested) suggested += 1;
      }
    }

    // Update account balance from latest balance_after if present
    const withBalance = [...parsed.transactions]
      .filter((t) => t.balanceAfter != null)
      .sort((a, b) => a.bookedDate.localeCompare(b.bookedDate));
    const latestBalance = withBalance.at(-1)?.balanceAfter;
    await db.prepare(
      `UPDATE bank_accounts SET last_sync_at = ?, source = ?, balance = COALESCE(?, balance), updated_at = ?
       WHERE id = ?`,
    ).run(now, input.format, latestBalance ?? null, now, input.bankAccountId);

    await writeAudit({
      action: 'import',
      entityType: 'bank_account',
      entityId: input.bankAccountId,
      actor: input.actor,
      newValues: {
        importBatchId,
        filename: input.filename,
        format: input.format,
        imported,
        duplicates,
        autoMatched,
        suggested,
      },
    });

    await timeline('reconciliation.imported', input.bankAccountId, {
      importBatchId,
      filename: input.filename,
      format: input.format,
      imported,
      duplicates,
      autoMatched,
      suggested,
    });

    let unmatched = 0;
    for (const t of created) {
      const latest = await getBankTransactionById(t.id);
      if (latest?.status === 'unmatched') unmatched += 1;
    }

    return {
      importBatchId,
      imported,
      duplicates,
      autoMatched,
      suggested,
      unmatched,
      warnings: parsed.warnings,
      transactions: await Promise.all(created.map(async (t) => (await getBankTransactionById(t.id))!)),
    };
  }

  async function approveMatch(
    matchId: string,
    actor?: ReconciliationActor,
    allocations?: Array<{ invoiceId: string; amount: number }>,
  ): Promise<{ match: ReconciliationMatch; payment: CustomerPayment }> {
    const match = await getMatchById(matchId);
    if (!match) throw new Error('RECONCILIATION_MATCH_NOT_FOUND');
    if (match.status === 'confirmed') throw new Error('RECONCILIATION_MATCH_ALREADY_CONFIRMED');
    const txn = await getBankTransactionById(match.bankTransactionId);
    if (!txn) throw new Error('BANK_TRANSACTION_NOT_FOUND');
    const allocs =
      allocations ??
      match.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }));
    return await confirmMatchWithPayment(match, txn, allocs, actor, 'approve_match');
  }

  async function manualMatch(
    input: {
      bankTransactionId: string;
      customerId: string;
      allocations: Array<{ invoiceId: string; amount: number }>;
      paymentMethod?: string;
      reference?: string;
      notes?: string;
    },
    actor?: ReconciliationActor,
  ): Promise<{ match: ReconciliationMatch; payment: CustomerPayment }> {
    const txn = await getBankTransactionById(input.bankTransactionId);
    if (!txn) throw new Error('BANK_TRANSACTION_NOT_FOUND');
    if (txn.status === 'matched') throw new Error('BANK_TRANSACTION_ALREADY_MATCHED');

    const match = await insertMatch({
      bankTransactionId: txn.id,
      bankAccountId: txn.bankAccountId,
      customerId: input.customerId,
      status: 'suggested',
      confidence: 1,
      confidenceBand: 'high',
      matchMethod: 'manual',
      rationale: ['Manually matched by user'],
      scores: {
        invoiceNumber: 1,
        reference: 1,
        amount: 1,
        customerName: 1,
        description: 1,
        date: 1,
        outstanding: 1,
      },
      allocations: input.allocations,
    });

    return await confirmMatchWithPayment(
      match,
      txn,
      input.allocations,
      actor,
      'manual_match',
      input.paymentMethod ?? 'Bank Transfer',
      input.reference,
      input.notes,
    );
  }

  async function ignoreTransactions(
    transactionIds: string[],
    actor?: ReconciliationActor,
  ): Promise<number> {
    const now = nowIso();
    let count = 0;
    for (const id of transactionIds) {
      const txn = await getBankTransactionById(id);
      if (!txn || txn.status === 'matched') continue;
      await db.prepare(
        `UPDATE bank_transactions SET status = 'ignored', updated_at = ? WHERE id = ?`,
      ).run(now, id);
      await db.prepare(
        `UPDATE reconciliation_matches SET status = 'rejected', updated_at = ?
         WHERE bank_transaction_id = ? AND status = 'suggested'`,
      ).run(now, id);
      await writeAudit({
        action: 'ignore',
        entityType: 'bank_transaction',
        entityId: id,
        bankTransactionId: id,
        actor,
        originalValues: { status: txn.status },
        newValues: { status: 'ignored' },
      });
      await timeline('reconciliation.ignored', id, { previousStatus: txn.status });
      count += 1;
    }
    return count;
  }

  async function unmatchTransaction(
    transactionId: string,
    actor?: ReconciliationActor,
  ): Promise<BankTransaction> {
    const txn = await getBankTransactionById(transactionId);
    if (!txn) throw new Error('BANK_TRANSACTION_NOT_FOUND');
    if (txn.status !== 'matched') throw new Error('BANK_TRANSACTION_NOT_MATCHED');

    const matches = await listMatches({ bankTransactionId: transactionId, status: 'confirmed' });
    const now = nowIso();
    for (const match of matches) {
      await db.prepare(
        `UPDATE reconciliation_matches SET status = 'rejected', updated_at = ? WHERE id = ?`,
      ).run(now, match.id);
      await writeAudit({
        action: 'unmatch',
        entityType: 'reconciliation_match',
        entityId: match.id,
        bankTransactionId: transactionId,
        matchId: match.id,
        actor,
        originalValues: {
          status: 'confirmed',
          customerPaymentId: match.customerPaymentId,
        },
        newValues: {
          status: 'rejected',
          note: 'Unmatched; linked customer payment retained for audit (payments are immutable)',
        },
      });
    }

    await db.prepare(
      `UPDATE bank_transactions SET status = 'unmatched', updated_at = ? WHERE id = ?`,
    ).run(now, transactionId);

    await timeline('reconciliation.unmatched', transactionId, {
      retainedPaymentIds: matches.map((m) => m.customerPaymentId).filter(Boolean),
    });

    return (await getBankTransactionById(transactionId))!;
  }

  async function listAudit(limit = 100): Promise<ReconciliationAuditEntry[]> {
    const rows = await db
      .prepare(
        `SELECT * FROM reconciliation_audit ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapReconciliationAuditRow);
  }

  async function getWorkspace(filter?: {
    bankAccountId?: string;
    status?: string;
    search?: string;
  }): Promise<ReconciliationWorkspace> {
    const transactions = await listBankTransactions(filter);
    const matchFilter: {
      bankTransactionId?: string;
      status?: string;
      bankAccountId?: string;
    } = {};
    if (filter?.bankAccountId) matchFilter.bankAccountId = filter.bankAccountId;
    if (filter?.status === 'suggested') matchFilter.status = 'suggested';
    const matches = (await listMatches(matchFilter)).filter((m) => {
      if (!filter?.status) return m.status === 'suggested' || m.status === 'confirmed';
      if (filter.status === 'suggested') return m.status === 'suggested';
      return true;
    });
    const all = await listBankTransactions(
      filter?.bankAccountId ? { bankAccountId: filter.bankAccountId } : undefined,
    );
    return {
      accounts: await listBankAccounts(),
      transactions,
      matches,
      summary: {
        unmatched: all.filter((t) => t.status === 'unmatched').length,
        suggested: all.filter((t) => t.status === 'suggested').length,
        matched: all.filter((t) => t.status === 'matched').length,
        ignored: all.filter((t) => t.status === 'ignored').length,
      },
    };
  }

  async function getReport(): Promise<ReconciliationReport> {
    const candidates = await listOpenInvoiceCandidates();
    const unmatchedPayments = (await listBankTransactions({ status: 'unmatched' })).filter(
      (t) => t.amount > 0,
    );
    const history = await listAudit(200);
    const matchedTxns = (await listBankTransactions({ status: 'matched' })).filter((t) => t.amount > 0);

    const byDay = new Map<string, { amount: number; count: number }>();
    for (const txn of matchedTxns) {
      const entry = byDay.get(txn.bookedDate) ?? { amount: 0, count: 0 };
      entry.amount += txn.amount;
      entry.count += 1;
      byDay.set(txn.bookedDate, entry);
    }

    const daily = new Map<
      string,
      { credits: number; debits: number; matched: number; unmatched: number }
    >();
    for (const txn of await listBankTransactions()) {
      const entry = daily.get(txn.bookedDate) ?? {
        credits: 0,
        debits: 0,
        matched: 0,
        unmatched: 0,
      };
      if (txn.amount >= 0) entry.credits += txn.amount;
      else entry.debits += Math.abs(txn.amount);
      if (txn.status === 'matched') entry.matched += 1;
      if (txn.status === 'unmatched' || txn.status === 'suggested') entry.unmatched += 1;
      daily.set(txn.bookedDate, entry);
    }

    const today = new Date();
    const aging = [
      { bucket: 'Current (0-30)', count: 0, amount: 0 },
      { bucket: '31-60', count: 0, amount: 0 },
      { bucket: '61-90', count: 0, amount: 0 },
      { bucket: '90+', count: 0, amount: 0 },
    ];
    for (const inv of candidates) {
      const due = Date.parse(inv.dueDate);
      const days = Number.isFinite(due)
        ? Math.floor((today.getTime() - due) / 86_400_000)
        : 0;
      let idx = 0;
      if (days > 90) idx = 3;
      else if (days > 60) idx = 2;
      else if (days > 30) idx = 1;
      aging[idx]!.count += 1;
      aging[idx]!.amount += inv.outstanding;
    }

    return {
      outstandingInvoices: candidates.map((c) => ({
        invoiceId: c.invoiceId,
        invoiceNumber: c.invoiceNumber,
        customerId: c.customerId,
        customerName: c.customerName,
        dueDate: c.dueDate,
        outstanding: c.outstanding,
      })),
      unmatchedPayments,
      reconciliationHistory: history,
      cashReceived: {
        total: matchedTxns.reduce((sum: number, t: BankTransaction) => sum + t.amount, 0),
        byDay: [...byDay.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, v]) => ({ date, amount: v.amount, count: v.count })),
      },
      dailyBankingSummary: [...daily.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 60)
        .map(([date, v]) => ({ date, ...v })),
      paymentAging: aging,
    };
  }

  async function rematchTransaction(
    transactionId: string,
    actor?: ReconciliationActor,
  ): Promise<BankTransaction> {
    const txn = await getBankTransactionById(transactionId);
    if (!txn) throw new Error('BANK_TRANSACTION_NOT_FOUND');
    if (txn.status === 'matched') throw new Error('BANK_TRANSACTION_ALREADY_MATCHED');

    await db.prepare(
      `UPDATE reconciliation_matches SET status = 'rejected', updated_at = ?
       WHERE bank_transaction_id = ? AND status = 'suggested'`,
    ).run(nowIso(), transactionId);
    await db.prepare(
      `UPDATE bank_transactions SET status = 'unmatched', updated_at = ? WHERE id = ?`,
    ).run(nowIso(), transactionId);

    const fresh = (await getBankTransactionById(transactionId))!;
    await runMatchingForTransaction(fresh, true, actor);
    return (await getBankTransactionById(transactionId))!;
  }

  return {
    createBankAccount: (input: CreateBankAccountInput) =>
      withTransaction(() => createBankAccount(input)),
    updateBankAccount: (id: string, input: UpdateBankAccountInput) =>
      withTransaction(() => updateBankAccount(id, input)),
    getBankAccountById: (id: string) => withTransaction(() => getBankAccountById(id)),
    listBankAccounts: () => withTransaction(() => listBankAccounts()),
    getBankTransactionById: (id: string) => withTransaction(() => getBankTransactionById(id)),
    listBankTransactions: (
      filter?: {
        bankAccountId?: string;
        status?: string;
        search?: string;
        importBatchId?: string;
      },
    ) => withTransaction(() => listBankTransactions(filter)),
    getMatchById: (id: string) => withTransaction(() => getMatchById(id)),
    listMatches: (
      filter?: {
        bankTransactionId?: string;
        status?: string;
        bankAccountId?: string;
      },
    ) => withTransaction(() => listMatches(filter)),
    importBankStatement: (input: {
      bankAccountId: string;
      format: 'csv' | 'ofx' | 'qif';
      filename: string;
      content: string;
      autoMatch?: boolean;
      actor?: ReconciliationActor;
    }) => withTransaction(() => importBankStatement(input)),
    approveMatch: (
      matchId: string,
      actor?: ReconciliationActor,
      allocations?: Array<{ invoiceId: string; amount: number }>,
    ) => withTransaction(() => approveMatch(matchId, actor, allocations)),
    manualMatch: (
      input: {
        bankTransactionId: string;
        customerId: string;
        allocations: Array<{ invoiceId: string; amount: number }>;
        paymentMethod?: string;
        reference?: string;
        notes?: string;
      },
      actor?: ReconciliationActor,
    ) => withTransaction(() => manualMatch(input, actor)),
    ignoreTransactions: (transactionIds: string[], actor?: ReconciliationActor) =>
      withTransaction(() => ignoreTransactions(transactionIds, actor)),
    unmatchTransaction: (transactionId: string, actor?: ReconciliationActor) =>
      withTransaction(() => unmatchTransaction(transactionId, actor)),
    rematchTransaction: (transactionId: string, actor?: ReconciliationActor) =>
      withTransaction(() => rematchTransaction(transactionId, actor)),
    listAudit: (limit?: number) => withTransaction(() => listAudit(limit)),
    getWorkspace: (filter?: {
      bankAccountId?: string;
      status?: string;
      search?: string;
    }) => withTransaction(() => getWorkspace(filter)),
    getReport: () => withTransaction(() => getReport()),
    runMatchingForTransaction: (
      txn: BankTransaction,
      autoApply: boolean,
      actor?: ReconciliationActor,
    ) => withTransaction(() => runMatchingForTransaction(txn, autoApply, actor)),
  };
}

export type PostgresReconciliationStore = ReturnType<typeof createPostgresReconciliationStore>;
