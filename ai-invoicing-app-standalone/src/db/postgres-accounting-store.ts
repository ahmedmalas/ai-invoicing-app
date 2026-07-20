import { randomUUID } from 'node:crypto';
import { AUSTRALIAN_CHART_OF_ACCOUNTS } from '../domain/accounting/chart-of-accounts.js';
import {
  assertJournalBalanced,
  invertJournalLines,
  roundMoney,
} from '../domain/accounting/journals.js';
import {
  buildMonthlyPeriods,
  dateInRange,
  defaultAustralianFinancialYear,
} from '../domain/accounting/periods.js';
import {
  buildAgeingReport,
  buildBalanceSheet,
  buildBasReport,
  buildGstDetail,
  buildGstSummary,
  buildLedgerEntries,
  buildProfitAndLoss,
  buildTrialBalance,
  toCsv,
  toExcelXml,
} from '../domain/accounting/reports.js';
import type {
  AccountingAuditEvent,
  AccountingDashboard,
  AccountingPeriod,
  AccountingPeriodStatus,
  AgeingReport,
  BalanceSheetReport,
  BasReport,
  ChartAccount,
  FinancialYear,
  GstDetailRow,
  GstSummaryReport,
  Journal,
  JournalAttachment,
  JournalLine,
  JournalLineInput,
  JournalSource,
  JournalStatus,
  LedgerEntry,
  ProfitAndLossReport,
  TrialBalanceRow,
} from '../domain/accounting/types.js';
import type { PostedLine } from '../domain/accounting/reports.js';

type PgStatement = {
  get: (...args: unknown[]) => Promise<unknown>;
  all: (...args: unknown[]) => Promise<unknown[]>;
  run: (...args: unknown[]) => Promise<unknown>;
};
type PgDb = { prepare: (sql: string) => PgStatement };

function nowIso(): string {
  return new Date().toISOString();
}

function asBool(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}

function mapAccount(row: Record<string, unknown>): ChartAccount {
  return {
    id: String(row.id),
    accountNumber: String(row.account_number),
    name: String(row.name),
    accountType: row.account_type as ChartAccount['accountType'],
    category: row.category as ChartAccount['category'],
    gstDefault: row.gst_default as ChartAccount['gstDefault'],
    isActive: asBool(row.is_active as number),
    isArchived: asBool(row.is_archived as number),
    isSystem: asBool(row.is_system as number),
    description: (row.description as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapYear(row: Record<string, unknown>): FinancialYear {
  return {
    id: String(row.id),
    label: String(row.label),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    status: row.status as FinancialYear['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPeriod(row: Record<string, unknown>): AccountingPeriod {
  return {
    id: String(row.id),
    financialYearId: String(row.financial_year_id),
    label: String(row.label),
    periodNumber: Number(row.period_number),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    status: row.status as AccountingPeriod['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapJournal(row: Record<string, unknown>): Journal {
  return {
    id: String(row.id),
    journalNumber: (row.journal_number as string | null) ?? null,
    status: row.status as JournalStatus,
    source: row.source as JournalSource,
    journalDate: String(row.journal_date),
    periodId: (row.period_id as string | null) ?? null,
    narration: String(row.narration),
    notes: (row.notes as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    approvedByUserId: (row.approved_by_user_id as string | null) ?? null,
    postedByUserId: (row.posted_by_user_id as string | null) ?? null,
    reversedByJournalId: (row.reversed_by_journal_id as string | null) ?? null,
    reversesJournalId: (row.reverses_journal_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    approvedAt: (row.approved_at as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
  };
}

export async function ensureAccountingSchemaPostgres(db: PgDb): Promise<void> {
  // CREATE TABLE IF NOT EXISTS already ran via schema.sql; seed COA + sequences.
  const count = (await db.prepare('SELECT COUNT(*) AS count FROM chart_of_accounts').get()) as {
    count: number;
  };
  if (count.count === 0) {
    const now = nowIso();
    const insert = db.prepare(
      `INSERT INTO chart_of_accounts
        (id, account_number, name, account_type, category, gst_default, is_active, is_archived, is_system, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
    );
    for (const seed of AUSTRALIAN_CHART_OF_ACCOUNTS) {
      await insert.run(
        randomUUID(),
        seed.accountNumber,
        seed.name,
        seed.accountType,
        seed.category,
        seed.gstDefault,
        seed.isSystem ? 1 : 0,
        seed.description ?? null,
        now,
        now,
      );
    }
  }
  const seq = await db.prepare('SELECT id FROM journal_sequences WHERE id = 1').get();
  if (!seq) {
    await db.prepare(
      `INSERT INTO journal_sequences (id, prefix, year, next_sequence) VALUES (1, 'JNL', ?, 1)`,
    ).run(new Date().getUTCFullYear());
  }
}

export function createPostgresAccountingStore(db: PgDb) {
  async function writeAudit(input: {
    entityType: string;
    entityId: string;
    action: string;
    actorUserId?: string | null;
    before?: unknown;
    after?: unknown;
    ipAddress?: string | null | undefined;
    sessionId?: string | null | undefined;
  }): Promise<void> {
    await db.prepare(
      `INSERT INTO accounting_audit_events
        (id, entity_type, entity_id, action, actor_user_id, before_json, after_json, ip_address, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.entityType,
      input.entityId,
      input.action,
      input.actorUserId ?? null,
      input.before == null ? null : JSON.stringify(input.before),
      input.after == null ? null : JSON.stringify(input.after),
      input.ipAddress ?? null,
      input.sessionId ?? null,
      nowIso(),
    );
  }

  async function listAccounts(filter?: {
    includeArchived?: boolean;
    accountType?: string;
  }): Promise<ChartAccount[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (!filter?.includeArchived) {
      clauses.push('is_archived = 0');
    }
    if (filter?.accountType) {
      clauses.push('account_type = ?');
      params.push(filter.accountType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.prepare(
        `SELECT * FROM chart_of_accounts ${where} ORDER BY account_number ASC`,
      ).all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapAccount);
  }

  async function getAccountByNumber(accountNumber: string): Promise<ChartAccount | null> {
    const row = (await db.prepare('SELECT * FROM chart_of_accounts WHERE account_number = ?').get(accountNumber)) as Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }

  async function getAccountById(id: string): Promise<ChartAccount | null> {
    const row = (await db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(id)) as Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }

  async function upsertAccount(input: {
    id?: string;
    accountNumber: string;
    name: string;
    accountType: ChartAccount['accountType'];
    category: ChartAccount['category'];
    gstDefault: ChartAccount['gstDefault'];
    isActive?: boolean;
    description?: string | null;
    actorUserId?: string | null;
  }): Promise<ChartAccount> {
    const now = nowIso();
    if (input.id) {
      const existing = await getAccountById(input.id);
      if (!existing) throw new Error('ACCOUNT_NOT_FOUND');
      if (existing.isSystem && input.accountNumber !== existing.accountNumber) {
        throw new Error('SYSTEM_ACCOUNT_PROTECTED');
      }
      await db.prepare(
        `UPDATE chart_of_accounts
         SET account_number = ?, name = ?, account_type = ?, category = ?, gst_default = ?,
             is_active = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.accountNumber,
        input.name,
        input.accountType,
        input.category,
        input.gstDefault,
        input.isActive === false ? 0 : 1,
        input.description ?? null,
        now,
        input.id,
      );
      const updated = (await getAccountById(input.id))!;
      await writeAudit({
        entityType: 'chart_of_accounts',
        entityId: input.id,
        action: 'updated',
        actorUserId: input.actorUserId ?? null,
        before: existing,
        after: updated,
      });
      return updated;
    }
    const id = randomUUID();
    await db.prepare(
      `INSERT INTO chart_of_accounts
        (id, account_number, name, account_type, category, gst_default, is_active, is_archived, is_system, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(
      id,
      input.accountNumber,
      input.name,
      input.accountType,
      input.category,
      input.gstDefault,
      input.isActive === false ? 0 : 1,
      input.description ?? null,
      now,
      now,
    );
    const created = (await getAccountById(id))!;
    await writeAudit({
      entityType: 'chart_of_accounts',
      entityId: id,
      action: 'created',
      actorUserId: input.actorUserId ?? null,
      after: created,
    });
    return created;
  }

  async function archiveAccount(id: string, actorUserId?: string | null): Promise<ChartAccount> {
    const existing = await getAccountById(id);
    if (!existing) throw new Error('ACCOUNT_NOT_FOUND');
    if (existing.isSystem) throw new Error('SYSTEM_ACCOUNT_PROTECTED');
    await db.prepare(
      `UPDATE chart_of_accounts SET is_archived = 1, is_active = 0, updated_at = ? WHERE id = ?`,
    ).run(nowIso(), id);
    const updated = (await getAccountById(id))!;
    await writeAudit({
      entityType: 'chart_of_accounts',
      entityId: id,
      action: 'archived',
      actorUserId: actorUserId ?? null,
      before: existing,
      after: updated,
    });
    return updated;
  }

  async function listFinancialYears(): Promise<FinancialYear[]> {
    return (
      (await db.prepare('SELECT * FROM financial_years ORDER BY start_date DESC').all()) as Array<
        Record<string, unknown>
      >
    ).map(mapYear);
  }

  async function getPeriodForDate(date: string): Promise<AccountingPeriod | null> {
    const row = await db.prepare(
        `SELECT * FROM accounting_periods
         WHERE start_date <= ? AND end_date >= ?
         ORDER BY start_date DESC LIMIT 1`,
      ).get(date, date) as Record<string, unknown> | undefined;
    return row ? mapPeriod(row) : null;
  }

  async function assertPeriodOpenForPosting(date: string): Promise<AccountingPeriod> {
    const period = await getPeriodForDate(date);
    if (!period) throw new Error('ACCOUNTING_PERIOD_NOT_FOUND');
    if (period.status === 'Locked' || period.status === 'Closed') {
      throw new Error('ACCOUNTING_PERIOD_LOCKED');
    }
    const year = (await db.prepare('SELECT status FROM financial_years WHERE id = ?').get(period.financialYearId)) as { status: string } | undefined;
    if (year?.status === 'Closed') throw new Error('FINANCIAL_YEAR_CLOSED');
    return period;
  }

  async function createFinancialYear(input?: {
    label?: string;
    startDate?: string;
    endDate?: string;
    actorUserId?: string | null;
  }): Promise<FinancialYear> {
    const defaults = defaultAustralianFinancialYear();
    const startDate = input?.startDate || defaults.startDate;
    const endDate = input?.endDate || defaults.endDate;
    const label = input?.label || defaults.label;
    const existing = await db.prepare('SELECT id FROM financial_years WHERE label = ?').get(label);
    if (existing) throw new Error('FINANCIAL_YEAR_EXISTS');
    const now = nowIso();
    const id = randomUUID();
    await db.prepare(
      `INSERT INTO financial_years (id, label, start_date, end_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Open', ?, ?)`,
    ).run(id, label, startDate, endDate, now, now);
    const periods = buildMonthlyPeriods(startDate, endDate);
    const insertPeriod = db.prepare(
      `INSERT INTO accounting_periods
        (id, financial_year_id, label, period_number, start_date, end_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?)`,
    );
    for (const period of periods) {
      await insertPeriod.run(
        randomUUID(),
        id,
        period.label,
        period.periodNumber,
        period.startDate,
        period.endDate,
        now,
        now,
      );
    }
    const year = mapYear(
      (await db.prepare('SELECT * FROM financial_years WHERE id = ?').get(id)) as Record<string, unknown>,
    );
    await writeAudit({
      entityType: 'financial_year',
      entityId: id,
      action: 'created',
      actorUserId: input?.actorUserId ?? null,
      after: year,
    });
    return year;
  }

  async function ensureCurrentFinancialYear(): Promise<FinancialYear> {
    const defaults = defaultAustralianFinancialYear();
    const existing = (await db.prepare('SELECT * FROM financial_years WHERE label = ?').get(defaults.label)) as Record<string, unknown> | undefined;
    if (existing) return mapYear(existing);
    return await createFinancialYear(defaults);
  }

  async function setFinancialYearStatus(
    id: string,
    status: FinancialYear['status'],
    actorUserId?: string | null,
  ): Promise<FinancialYear> {
    const before = await db.prepare('SELECT * FROM financial_years WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!before) throw new Error('FINANCIAL_YEAR_NOT_FOUND');
    await db.prepare(`UPDATE financial_years SET status = ?, updated_at = ? WHERE id = ?`).run(
      status,
      nowIso(),
      id,
    );
    if (status === 'Closed') {
      await db.prepare(
        `UPDATE accounting_periods SET status = 'Closed', updated_at = ? WHERE financial_year_id = ?`,
      ).run(nowIso(), id);
    }
    const after = mapYear(
      (await db.prepare('SELECT * FROM financial_years WHERE id = ?').get(id)) as Record<string, unknown>,
    );
    await writeAudit({
      entityType: 'financial_year',
      entityId: id,
      action: status === 'Closed' ? 'closed' : 'opened',
      actorUserId: actorUserId ?? null,
      before: mapYear(before),
      after,
    });
    return after;
  }

  async function listPeriods(financialYearId?: string): Promise<AccountingPeriod[]> {
    if (financialYearId) {
      return (
        await db.prepare(
            `SELECT * FROM accounting_periods WHERE financial_year_id = ? ORDER BY period_number ASC`,
          ).all(financialYearId) as Array<Record<string, unknown>>
      ).map(mapPeriod);
    }
    return (
      (await db.prepare(`SELECT * FROM accounting_periods ORDER BY start_date ASC`).all()) as Array<Record<string, unknown>>
    ).map(mapPeriod);
  }

  async function setPeriodStatus(
    id: string,
    status: AccountingPeriodStatus,
    actorUserId?: string | null,
  ): Promise<AccountingPeriod> {
    const before = await db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!before) throw new Error('ACCOUNTING_PERIOD_NOT_FOUND');
    await db.prepare(`UPDATE accounting_periods SET status = ?, updated_at = ? WHERE id = ?`).run(
      status,
      nowIso(),
      id,
    );
    const after = mapPeriod(
      (await db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(id)) as Record<string, unknown>,
    );
    await writeAudit({
      entityType: 'accounting_period',
      entityId: id,
      action: `status:${status}`,
      actorUserId: actorUserId ?? null,
      before: mapPeriod(before),
      after,
    });
    return after;
  }

  async function loadJournalLines(journalId: string): Promise<JournalLine[]> {
    const rows = await db.prepare(
        `SELECT jl.*, coa.account_number, coa.name AS account_name
         FROM journal_lines jl
         JOIN chart_of_accounts coa ON coa.id = jl.account_id
         WHERE jl.journal_id = ?
         ORDER BY jl.line_number ASC`,
      ).all(journalId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      journalId: String(row.journal_id),
      lineNumber: Number(row.line_number),
      accountId: String(row.account_id),
      description: (row.description as string | null) ?? null,
      debit: Number(row.debit),
      credit: Number(row.credit),
      gstAmount: row.gst_amount == null ? null : Number(row.gst_amount),
      gstCode: (row.gst_code as JournalLine['gstCode']) ?? null,
      accountNumber: String(row.account_number),
      accountName: String(row.account_name),
    }));
  }

  async function getJournalById(id: string): Promise<(Journal & { lines: JournalLine[] }) | null> {
    const row = await db.prepare('SELECT * FROM journals WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return { ...mapJournal(row), lines: await loadJournalLines(id) };
  }

  async function allocateJournalNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const row = (await db.prepare('SELECT * FROM journal_sequences WHERE id = 1').get()) as {
      prefix: string;
      year: number;
      next_sequence: number;
    };
    let sequence = row.next_sequence;
    const prefix = row.prefix;
    let seqYear = row.year;
    if (seqYear !== year) {
      seqYear = year;
      sequence = 1;
    }
    await db.prepare(
      `UPDATE journal_sequences SET year = ?, next_sequence = ? WHERE id = 1`,
    ).run(seqYear, sequence + 1);
    return `${prefix}-${seqYear}-${String(sequence).padStart(6, '0')}`;
  }

  async function replaceLines(journalId: string, lines: JournalLineInput[]): Promise<void> {
    assertJournalBalanced(lines);
    await db.prepare('DELETE FROM journal_lines WHERE journal_id = ?').run(journalId);
    const insert = db.prepare(
      `INSERT INTO journal_lines
        (id, journal_id, line_number, account_id, description, debit, credit, gst_amount, gst_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!(await getAccountById(line.accountId))) throw new Error('ACCOUNT_NOT_FOUND');
      await insert.run(
        randomUUID(),
        journalId,
        index + 1,
        line.accountId,
        line.description ?? null,
        roundMoney(Number(line.debit || 0)),
        roundMoney(Number(line.credit || 0)),
        line.gstAmount == null ? null : roundMoney(Number(line.gstAmount)),
        line.gstCode ?? null,
      );
    }
  }

  async function createJournal(input: {
    journalDate: string;
    narration: string;
    notes?: string | null;
    reference?: string | null;
    source?: JournalSource;
    status?: 'Draft' | 'Approved';
    lines: JournalLineInput[];
    actorUserId?: string | null;
  }): Promise<Journal & { lines: JournalLine[] }> {
    await ensureCurrentFinancialYear();
    assertJournalBalanced(input.lines);
    const period = await getPeriodForDate(input.journalDate);
    if (!period) throw new Error('ACCOUNTING_PERIOD_NOT_FOUND');
    if (period.status !== 'Open') throw new Error('ACCOUNTING_PERIOD_LOCKED');
    const id = randomUUID();
    const now = nowIso();
    const status = input.status || 'Draft';
    await db.prepare(
      `INSERT INTO journals
        (id, journal_number, status, source, journal_date, period_id, narration, notes, reference,
         created_by_user_id, created_at, updated_at, approved_at, approved_by_user_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      status,
      input.source || 'Manual',
      input.journalDate,
      period.id,
      input.narration,
      input.notes ?? null,
      input.reference ?? null,
      input.actorUserId ?? null,
      now,
      now,
      status === 'Approved' ? now : null,
      status === 'Approved' ? (input.actorUserId ?? null) : null,
    );
    await replaceLines(id, input.lines);
    const journal = (await getJournalById(id))!;
    await writeAudit({
      entityType: 'journal',
      entityId: id,
      action: 'created',
      actorUserId: input.actorUserId ?? null,
      after: journal,
    });
    return journal;
  }

  async function updateDraftJournal(
    id: string,
    input: {
      journalDate?: string;
      narration?: string;
      notes?: string | null;
      reference?: string | null;
      lines?: JournalLineInput[];
      actorUserId?: string | null;
    },
  ): Promise<Journal & { lines: JournalLine[] }> {
    const existing = await getJournalById(id);
    if (!existing) throw new Error('JOURNAL_NOT_FOUND');
    if (existing.status !== 'Draft') throw new Error('JOURNAL_NOT_DRAFT');
    const journalDate = input.journalDate || existing.journalDate;
    const period = await getPeriodForDate(journalDate);
    if (!period || period.status !== 'Open') throw new Error('ACCOUNTING_PERIOD_LOCKED');
    await db.prepare(
      `UPDATE journals
       SET journal_date = ?, period_id = ?, narration = ?, notes = ?, reference = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      journalDate,
      period.id,
      input.narration ?? existing.narration,
      input.notes === undefined ? existing.notes : input.notes,
      input.reference === undefined ? existing.reference : input.reference,
      nowIso(),
      id,
    );
    if (input.lines) await replaceLines(id, input.lines);
    const updated = (await getJournalById(id))!;
    await writeAudit({
      entityType: 'journal',
      entityId: id,
      action: 'updated',
      actorUserId: input.actorUserId ?? null,
      before: existing,
      after: updated,
    });
    return updated;
  }

  async function approveJournal(
    id: string,
    actorUserId?: string | null,
  ): Promise<Journal & { lines: JournalLine[] }> {
    const existing = await getJournalById(id);
    if (!existing) throw new Error('JOURNAL_NOT_FOUND');
    if (existing.status !== 'Draft') throw new Error('JOURNAL_NOT_DRAFT');
    assertJournalBalanced(existing.lines);
    await db.prepare(
      `UPDATE journals SET status = 'Approved', approved_at = ?, approved_by_user_id = ?, updated_at = ? WHERE id = ?`,
    ).run(nowIso(), actorUserId ?? null, nowIso(), id);
    const updated = (await getJournalById(id))!;
    await writeAudit({
      entityType: 'journal',
      entityId: id,
      action: 'approved',
      actorUserId: actorUserId ?? null,
      before: existing,
      after: updated,
    });
    return updated;
  }

  async function postJournal(
    id: string,
    actorUserId?: string | null,
  ): Promise<Journal & { lines: JournalLine[] }> {
    const existing = await getJournalById(id);
    if (!existing) throw new Error('JOURNAL_NOT_FOUND');
    if (existing.status !== 'Draft' && existing.status !== 'Approved') {
      throw new Error('JOURNAL_NOT_POSTABLE');
    }
    assertJournalBalanced(existing.lines);
    await assertPeriodOpenForPosting(existing.journalDate);
    const journalNumber = await allocateJournalNumber();
    await db.prepare(
      `UPDATE journals
       SET status = 'Posted', journal_number = ?, posted_at = ?, posted_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(journalNumber, nowIso(), actorUserId ?? null, nowIso(), id);
    const updated = (await getJournalById(id))!;
    await writeAudit({
      entityType: 'journal',
      entityId: id,
      action: 'posted',
      actorUserId: actorUserId ?? null,
      before: existing,
      after: updated,
    });
    return updated;
  }

  async function reverseJournal(
    id: string,
    actorUserId?: string | null,
  ): Promise<Journal & { lines: JournalLine[] }> {
    const existing = await getJournalById(id);
    if (!existing) throw new Error('JOURNAL_NOT_FOUND');
    if (existing.status !== 'Posted') throw new Error('JOURNAL_NOT_POSTED');
    if (existing.reversedByJournalId) throw new Error('JOURNAL_ALREADY_REVERSED');
    const reversal = await createJournal({
      journalDate: existing.journalDate,
      narration: `Reversal of ${existing.journalNumber}`,
      notes: existing.notes,
      reference: existing.reference,
      source: 'Reversal',
      status: 'Approved',
      lines: invertJournalLines(existing.lines),
      actorUserId: actorUserId ?? null,
    });
    await db.prepare(`UPDATE journals SET reverses_journal_id = ? WHERE id = ?`).run(id, reversal.id);
    const posted = await postJournal(reversal.id, actorUserId);
    await db.prepare(
      `UPDATE journals SET status = 'Reversed', reversed_by_journal_id = ?, updated_at = ? WHERE id = ?`,
    ).run(posted.id, nowIso(), id);
    await writeAudit({
      entityType: 'journal',
      entityId: id,
      action: 'reversed',
      actorUserId: actorUserId ?? null,
      before: existing,
      after: await getJournalById(id),
    });
    return posted;
  }

  async function addJournalAttachment(input: {
    journalId: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
  }): Promise<JournalAttachment> {
    if (!await getJournalById(input.journalId)) throw new Error('JOURNAL_NOT_FOUND');
    const id = randomUUID();
    const createdAt = nowIso();
    await db.prepare(
      `INSERT INTO journal_attachments (id, journal_id, file_name, content_type, content_base64, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.journalId,
      input.fileName,
      input.contentType,
      input.contentBase64,
      createdAt,
    );
    return {
      id,
      journalId: input.journalId,
      fileName: input.fileName,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      createdAt,
    };
  }

  async function listJournals(filter?: {
    status?: JournalStatus;
    from?: string;
    to?: string;
  }): Promise<Journal[]> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.from) {
      clauses.push('journal_date >= ?');
      params.push(filter.from);
    }
    if (filter?.to) {
      clauses.push('journal_date <= ?');
      params.push(filter.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return (
      (await db.prepare(`SELECT * FROM journals ${where} ORDER BY journal_date DESC, created_at DESC`).all(...params)) as Array<Record<string, unknown>>
    ).map(mapJournal);
  }

  async function loadPostedLines(filter?: { from?: string; to?: string; accountId?: string }): Promise<PostedLine[]> {
    const clauses = [`j.status = 'Posted'`];
    const params: string[] = [];
    if (filter?.from) {
      clauses.push('j.journal_date >= ?');
      params.push(filter.from);
    }
    if (filter?.to) {
      clauses.push('j.journal_date <= ?');
      params.push(filter.to);
    }
    if (filter?.accountId) {
      clauses.push('jl.account_id = ?');
      params.push(filter.accountId);
    }
    const rows = await db.prepare(
        `SELECT jl.*, j.journal_date, j.journal_number, j.narration, j.status,
                coa.account_type, coa.account_number, coa.name AS account_name
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id
         JOIN chart_of_accounts coa ON coa.id = jl.account_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY j.journal_date ASC, j.journal_number ASC, jl.line_number ASC`,
      ).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      journalId: String(row.journal_id),
      lineNumber: Number(row.line_number),
      accountId: String(row.account_id),
      description: (row.description as string | null) ?? null,
      debit: Number(row.debit),
      credit: Number(row.credit),
      gstAmount: row.gst_amount == null ? null : Number(row.gst_amount),
      gstCode: (row.gst_code as PostedLine['gstCode']) ?? null,
      journalDate: String(row.journal_date),
      journalNumber: (row.journal_number as string | null) ?? null,
      narration: String(row.narration),
      status: 'Posted',
      accountType: row.account_type as PostedLine['accountType'],
      accountNumber: String(row.account_number),
      accountName: String(row.account_name),
    }));
  }

  async function getGeneralLedger(accountId: string, from?: string, to?: string): Promise<{
    account: ChartAccount;
    entries: LedgerEntry[];
  }> {
    const account = await getAccountById(accountId);
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    const lines = await loadPostedLines({ accountId, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    return { account, entries: buildLedgerEntries(lines) };
  }

  async function getTrialBalance(asAt?: string): Promise<TrialBalanceRow[]> {
    const to = asAt || nowIso().slice(0, 10);
    return buildTrialBalance(await listAccounts({ includeArchived: true }), await loadPostedLines({ to }));
  }

  async function getProfitAndLoss(from: string, to: string): Promise<ProfitAndLossReport> {
    return buildProfitAndLoss(from, to, await listAccounts({ includeArchived: true }), await loadPostedLines());
  }

  async function getBalanceSheet(asAt: string): Promise<BalanceSheetReport> {
    return buildBalanceSheet(asAt, await listAccounts({ includeArchived: true }), await loadPostedLines({ to: asAt }));
  }

  async function getGstDetail(from: string, to: string): Promise<GstDetailRow[]> {
    return buildGstDetail(await loadPostedLines({ from, to }));
  }

  async function getGstSummary(from: string, to: string): Promise<GstSummaryReport> {
    return buildGstSummary(from, to, await getGstDetail(from, to));
  }

  async function getBasReport(from: string, to: string): Promise<BasReport> {
    return buildBasReport(from, to, await getGstDetail(from, to));
  }

  async function getGstExceptions(from: string, to: string): Promise<GstDetailRow[]> {
    const rows = await getGstDetail(from, to);
    return rows.filter(
      (row) =>
        (row.gstCode === 'GST' && Math.abs(row.gstAmount - roundMoney(row.netAmount * 0.1)) > 0.05) ||
        row.gstAmount < 0,
    );
  }

  async function getAgedReceivables(asAt: string): Promise<AgeingReport> {
    const rows = await db.prepare(
        `SELECT i.id AS document_id,
                COALESCE(i.invoice_number, i.id) AS document_number,
                i.due_date AS due_date,
                i.customer_id AS party_id,
                c.display_name AS party_name,
                ROUND(i.total
                  - COALESCE((SELECT SUM(cn.total_credit) FROM credit_notes cn WHERE cn.linked_invoice_id = i.id), 0)
                  - COALESCE((
                      SELECT SUM(pa.amount)
                      FROM payment_allocations pa
                      WHERE pa.invoice_id = i.id
                    ), 0), 2) AS outstanding
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.status = 'Finalised'`,
      ).all() as Array<{
      document_id: string;
      document_number: string;
      due_date: string;
      party_id: string;
      party_name: string;
      outstanding: number;
    }>;
    return buildAgeingReport(
      asAt,
      rows.map((row) => ({
        partyId: row.party_id,
        partyName: row.party_name,
        documentId: row.document_id,
        documentNumber: row.document_number,
        dueDate: row.due_date,
        outstanding: Number(row.outstanding),
      })),
    );
  }

  async function getAgedPayables(asAt: string): Promise<AgeingReport> {
    const rows = await db.prepare(
        `SELECT b.id AS document_id,
                COALESCE(b.bill_number, b.id) AS document_number,
                b.due_date AS due_date,
                b.supplier_id AS party_id,
                s.display_name AS party_name,
                ROUND(b.total
                  - COALESCE((
                      SELECT SUM(spa.amount)
                      FROM supplier_payment_allocations spa
                      WHERE spa.supplier_bill_id = b.id
                    ), 0), 2) AS outstanding
         FROM supplier_bills b
         JOIN suppliers s ON s.id = b.supplier_id
         WHERE b.status = 'Finalised'`,
      ).all() as Array<{
      document_id: string;
      document_number: string;
      due_date: string;
      party_id: string;
      party_name: string;
      outstanding: number;
    }>;
    return buildAgeingReport(
      asAt,
      rows.map((row) => ({
        partyId: row.party_id,
        partyName: row.party_name,
        documentId: row.document_id,
        documentNumber: row.document_number,
        dueDate: row.due_date,
        outstanding: Number(row.outstanding),
      })),
    );
  }

  async function listAuditEvents(entityType?: string, entityId?: string): Promise<AccountingAuditEvent[]> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (entityType) {
      clauses.push('entity_type = ?');
      params.push(entityType);
    }
    if (entityId) {
      clauses.push('entity_id = ?');
      params.push(entityId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return (
      await db.prepare(
          `SELECT * FROM accounting_audit_events ${where} ORDER BY created_at DESC LIMIT 500`,
        ).all(...params) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      action: String(row.action),
      actorUserId: (row.actor_user_id as string | null) ?? null,
      beforeJson: (row.before_json as string | null) ?? null,
      afterJson: (row.after_json as string | null) ?? null,
      ipAddress: (row.ip_address as string | null) ?? null,
      sessionId: (row.session_id as string | null) ?? null,
      createdAt: String(row.created_at),
    }));
  }

  async function getAccountingDashboard(): Promise<AccountingDashboard> {
    const year = await ensureCurrentFinancialYear();
    const asAt = nowIso().slice(0, 10);
    const cash = await getAccountByNumber('1-1000');
    const gstPayable = await getAccountByNumber('2-1100');
    const gstReceivable = await getAccountByNumber('1-1500');
    const ledgerBalance = async (accountId: string | undefined) => {
      if (!accountId) return 0;
      const { entries } = await getGeneralLedger(accountId);
      return entries.length ? entries[entries.length - 1]!.runningBalance : 0;
    };
    const ar = await getAgedReceivables(asAt);
    const ap = await getAgedPayables(asAt);
    const pnl = await getProfitAndLoss(year.startDate, asAt);
    const today = asAt;
    const bankBalance = await ledgerBalance(cash?.id);
    const gstPayableBal = await ledgerBalance(gstPayable?.id);
    const gstReceivableBal = await ledgerBalance(gstReceivable?.id);
    return {
      bankBalance,
      gstPayable: gstPayableBal,
      gstReceivable: gstReceivableBal,
      receivables: ar.total,
      payables: ap.total,
      netProfit: pnl.netProfit,
      cashFlow: roundMoney(bankBalance),
      financialYearLabel: year.label,
      overdueInvoices: ar.rows.filter((row) => row.dueDate < today).length,
      overdueSupplierBills: ap.rows.filter((row) => row.dueDate < today).length,
    };
  }

  async function createAutoSalesJournal(input: {
    journalDate: string;
    invoiceId: string;
    invoiceNumber: string | null;
    subtotal: number;
    gstTotal: number;
    total: number;
    actorUserId?: string | null;
  }): Promise<Journal & { lines: JournalLine[] }> {
    await ensureCurrentFinancialYear();
    const ar = await getAccountByNumber('1-1200');
    const sales = await getAccountByNumber('4-1100') || await getAccountByNumber('4-1000');
    const gstPayable = await getAccountByNumber('2-1100');
    if (!ar || !sales || !gstPayable) throw new Error('SYSTEM_ACCOUNTS_MISSING');
    const lines: JournalLineInput[] = [
      {
        accountId: ar.id,
        description: input.invoiceNumber || input.invoiceId,
        debit: roundMoney(input.total),
        credit: 0,
      },
      {
        accountId: sales.id,
        description: 'Service income',
        debit: 0,
        credit: roundMoney(input.subtotal),
        gstAmount: roundMoney(input.gstTotal),
        gstCode: 'GST',
      },
    ];
    if (input.gstTotal > 0) {
      lines.push({
        accountId: gstPayable.id,
        description: 'GST on sales',
        debit: 0,
        credit: roundMoney(input.gstTotal),
        gstAmount: roundMoney(input.gstTotal),
        gstCode: 'GST',
      });
    }
    const draft = await createJournal({
      journalDate: input.journalDate,
      narration: `Auto journal for invoice ${input.invoiceNumber || input.invoiceId}`,
      reference: input.invoiceId,
      source: 'Auto',
      status: 'Approved',
      lines,
      actorUserId: input.actorUserId ?? null,
    });
    return await postJournal(draft.id, input.actorUserId);
  }

  return {
    ensureSeeded: async () => await ensureAccountingSchemaPostgres(db),
    listAccounts,
    getAccountById,
    getAccountByNumber,
    upsertAccount,
    archiveAccount,
    listFinancialYears,
    createFinancialYear,
    ensureCurrentFinancialYear,
    setFinancialYearStatus,
    listPeriods,
    setPeriodStatus,
    getPeriodForDate,
    createJournal,
    updateDraftJournal,
    approveJournal,
    postJournal,
    reverseJournal,
    getJournalById,
    listJournals,
    addJournalAttachment,
    getGeneralLedger,
    getTrialBalance,
    getProfitAndLoss,
    getBalanceSheet,
    getGstDetail,
    getGstSummary,
    getGstExceptions,
    getBasReport,
    getAgedReceivables,
    getAgedPayables,
    listAuditEvents,
    getAccountingDashboard,
    createAutoSalesJournal,
    exportCsv: toCsv,
    exportExcel: toExcelXml,
    dateInRange,
  };
}

export type PostgresAccountingStore = ReturnType<typeof createPostgresAccountingStore>;
