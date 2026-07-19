import { createHash } from 'node:crypto';

export interface ParsedBankTransaction {
  bookedDate: string;
  amount: number;
  description: string | null;
  reference: string | null;
  counterpartyName: string | null;
  balanceAfter: number | null;
  bsb: string | null;
  accountNumber: string | null;
  raw: Record<string, unknown>;
}

export interface ParseStatementResult {
  transactions: ParsedBankTransaction[];
  warnings: string[];
}

function fingerprint(input: {
  bankAccountId: string;
  bookedDate: string;
  amount: number;
  description: string | null;
  reference: string | null;
}): string {
  return createHash('sha256')
    .update(
      [
        input.bankAccountId,
        input.bookedDate,
        input.amount.toFixed(2),
        (input.description || '').trim().toLowerCase(),
        (input.reference || '').trim().toLowerCase(),
      ].join('|'),
    )
    .digest('hex');
}

export function transactionFingerprint(
  bankAccountId: string,
  txn: ParsedBankTransaction,
): string {
  return fingerprint({
    bankAccountId,
    bookedDate: txn.bookedDate,
    amount: txn.amount,
    description: txn.description,
    reference: txn.reference,
  });
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const month = dmy[2]!.padStart(2, '0');
    let year = dmy[3]!;
    if (year.length === 2) year = Number(year) > 70 ? `19${year}` : `20${year}`;
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '').replace(/\((.*)\)/, '-$1');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvBankStatement(content: string): ParseStatementResult {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const warnings: string[] = [];
  if (lines.length < 2) return { transactions: [], warnings: ['CSV has no data rows.'] };

  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const indexOf = (...names: string[]) =>
    headers.findIndex((header) => names.some((name) => header.includes(name)));

  const dateIdx = indexOf('date', 'booked', 'posted');
  const amountIdx = indexOf('amount', 'credit', 'value');
  const descIdx = indexOf('description', 'narration', 'details', 'memo');
  const refIdx = indexOf('reference', 'ref', 'cheque', 'check');
  const nameIdx = indexOf('name', 'payee', 'counterparty', 'merchant');
  const balanceIdx = indexOf('balance');
  const bsbIdx = indexOf('bsb');
  const accountIdx = indexOf('account');

  if (dateIdx < 0 || amountIdx < 0) {
    return { transactions: [], warnings: ['CSV must include Date and Amount columns.'] };
  }

  const transactions: ParsedBankTransaction[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const bookedDate = normalizeDate(cells[dateIdx] || '');
    const amount = parseAmount(cells[amountIdx] || '');
    if (!bookedDate || amount == null) {
      warnings.push(`Skipped row: ${line.slice(0, 80)}`);
      continue;
    }
    transactions.push({
      bookedDate,
      amount,
      description: descIdx >= 0 ? cells[descIdx] || null : null,
      reference: refIdx >= 0 ? cells[refIdx] || null : null,
      counterpartyName: nameIdx >= 0 ? cells[nameIdx] || null : null,
      balanceAfter: balanceIdx >= 0 ? parseAmount(cells[balanceIdx] || '') : null,
      bsb: bsbIdx >= 0 ? cells[bsbIdx] || null : null,
      accountNumber: accountIdx >= 0 ? cells[accountIdx] || null : null,
      raw: { line, cells },
    });
  }
  return { transactions, warnings };
}

export function parseOfxBankStatement(content: string): ParseStatementResult {
  const warnings: string[] = [];
  const transactions: ParsedBankTransaction[] = [];
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const field = (tag: string) => {
      const match = block.match(new RegExp(`<${tag}>([^\\n<]+)`, 'i'));
      return match?.[1]?.trim() || null;
    };
    const dateRaw = field('DTPOSTED') || field('DTUSER');
    const amountRaw = field('TRNAMT');
    if (!dateRaw || !amountRaw) {
      warnings.push('Skipped OFX transaction missing date/amount.');
      continue;
    }
    const bookedDate = normalizeDate(
      dateRaw.length >= 8 ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : dateRaw,
    );
    const amount = parseAmount(amountRaw);
    if (!bookedDate || amount == null) {
      warnings.push(`Skipped OFX transaction: ${dateRaw} ${amountRaw}`);
      continue;
    }
    transactions.push({
      bookedDate,
      amount,
      description: field('MEMO') || field('NAME'),
      reference: field('FITID') || field('CHECKNUM') || field('REFNUM'),
      counterpartyName: field('NAME'),
      balanceAfter: null,
      bsb: null,
      accountNumber: null,
      raw: { block: block.slice(0, 400) },
    });
  }
  if (!transactions.length) warnings.push('No STMTTRN blocks found in OFX file.');
  return { transactions, warnings };
}

export function parseQifBankStatement(content: string): ParseStatementResult {
  const warnings: string[] = [];
  const transactions: ParsedBankTransaction[] = [];
  const records = content.split('^');
  for (const record of records) {
    const lines = record
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    let bookedDate: string | null = null;
    let amount: number | null = null;
    let description: string | null = null;
    let reference: string | null = null;
    let counterpartyName: string | null = null;
    for (const line of lines) {
      const code = line[0];
      const value = line.slice(1).trim();
      if (code === 'D') bookedDate = normalizeDate(value);
      if (code === 'T' || code === 'U') amount = parseAmount(value);
      if (code === 'P') counterpartyName = value || null;
      if (code === 'M' || code === 'N') description = value || description;
      if (code === 'N') reference = value || reference;
    }
    if (!bookedDate || amount == null) {
      if (lines.some((line) => line.startsWith('D') || line.startsWith('T'))) {
        warnings.push(`Skipped QIF record: ${lines.join(' ').slice(0, 80)}`);
      }
      continue;
    }
    transactions.push({
      bookedDate,
      amount,
      description,
      reference,
      counterpartyName,
      balanceAfter: null,
      bsb: null,
      accountNumber: null,
      raw: { lines },
    });
  }
  return { transactions, warnings };
}

export function parseBankStatement(
  format: 'csv' | 'ofx' | 'qif',
  content: string,
): ParseStatementResult {
  if (format === 'csv') return parseCsvBankStatement(content);
  if (format === 'ofx') return parseOfxBankStatement(content);
  return parseQifBankStatement(content);
}
