import {
  MATCH_CONFIDENCE_HIGH,
  MATCH_CONFIDENCE_MEDIUM,
  type MatchCandidateScore,
  type MatchConfidenceBand,
  type MatchMethod,
  type ParsedBankTransactionLike,
} from './types.js';

// Re-export shape used by parsers without circular import of statement-import
export type { ParsedBankTransactionLike };

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInvoiceNumbers(text: string): string[] {
  const matches = text.match(/\b(?:INV[-_]?)?\d{3,}\b/gi) ?? [];
  return [...new Set(matches.map((m) => m.toUpperCase().replace(/^INV[-_]?/i, 'INV-')))];
}

function dateProximityScore(txnDate: string, invoiceDate: string, dueDate: string): number {
  const txn = Date.parse(txnDate);
  const issued = Date.parse(invoiceDate);
  const due = Date.parse(dueDate);
  if (!Number.isFinite(txn) || !Number.isFinite(issued)) return 0;
  const daysFromIssue = Math.abs(txn - issued) / 86_400_000;
  const daysFromDue = Number.isFinite(due) ? Math.abs(txn - due) / 86_400_000 : daysFromIssue;
  const best = Math.min(daysFromIssue, daysFromDue);
  if (best <= 3) return 1;
  if (best <= 14) return 0.7;
  if (best <= 45) return 0.4;
  if (best <= 90) return 0.15;
  return 0;
}

function nameOverlapScore(haystack: string, customerName: string): number {
  const hay = normalizeText(haystack);
  const name = normalizeText(customerName);
  if (!hay || !name) return 0;
  if (hay.includes(name)) return 1;
  const tokens = name.split(' ').filter((t) => t.length >= 3);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

function bandForScore(score: number): MatchConfidenceBand {
  if (score >= MATCH_CONFIDENCE_HIGH) return 'high';
  if (score >= MATCH_CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

export interface MatchableInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  title: string;
  /** Outstanding amount in major currency units (dollars). */
  outstanding: number;
}

export interface ScoredMatchSuggestion {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  confidence: number;
  confidenceBand: MatchConfidenceBand;
  matchMethod: MatchMethod;
  reasons: string[];
  scores: MatchCandidateScore;
}

/**
 * Score a credit bank transaction against open invoices.
 * Returns suggestions sorted by confidence (highest first).
 */
export function scoreTransactionMatches(
  txn: ParsedBankTransactionLike,
  candidates: MatchableInvoice[],
): ScoredMatchSuggestion[] {
  if (txn.amount <= 0) return [];

  const blob = [txn.description, txn.reference, txn.counterpartyName].filter(Boolean).join(' ');
  const mentionedInvoices = new Set(extractInvoiceNumbers(blob));
  const suggestions: ScoredMatchSuggestion[] = [];

  for (const candidate of candidates) {
    if (candidate.outstanding <= 0) continue;
    const outstanding = candidate.outstanding;
    const customerName = candidate.customerName;
    const reasons: string[] = [];
    const scores: MatchCandidateScore = {
      invoiceNumber: 0,
      reference: 0,
      amount: 0,
      customerName: 0,
      description: 0,
      date: 0,
      outstanding: 0,
    };

    const invNumNorm = candidate.invoiceNumber.toUpperCase();
    const invNumBare = invNumNorm.replace(/^INV[-_]?/i, '');
    if (
      mentionedInvoices.has(invNumNorm) ||
      mentionedInvoices.has(`INV-${invNumBare}`) ||
      normalizeText(blob).includes(normalizeText(candidate.invoiceNumber))
    ) {
      scores.invoiceNumber = 1;
      reasons.push(`Invoice number ${candidate.invoiceNumber} found in payment description`);
    }

    if (
      txn.reference &&
      normalizeText(txn.reference).includes(normalizeText(candidate.invoiceNumber))
    ) {
      scores.reference = 1;
      reasons.push('Reference matches invoice number');
    } else if (
      txn.reference &&
      candidate.title &&
      normalizeText(txn.reference).includes(normalizeText(candidate.title).slice(0, 12))
    ) {
      scores.reference = 0.6;
    }

    const amountDiff = Math.abs(txn.amount - outstanding);
    if (amountDiff < 0.005) {
      scores.amount = 1;
      scores.outstanding = 1;
      reasons.push('Exact outstanding amount');
    } else if (txn.amount < outstanding && txn.amount > 0) {
      const ratio = txn.amount / outstanding;
      scores.amount = 0.55 + ratio * 0.25;
      scores.outstanding = ratio;
      reasons.push(`Partial payment (${Math.round(ratio * 100)}% of outstanding)`);
    } else if (txn.amount > outstanding && amountDiff / Math.max(outstanding, 1) <= 0.02) {
      scores.amount = 0.9;
      scores.outstanding = 0.95;
      reasons.push('Amount within 2% of outstanding');
    } else if (txn.amount > outstanding && scores.invoiceNumber >= 1) {
      // One deposit covering this invoice (and possibly others)
      scores.amount = 0.88;
      scores.outstanding = 1;
      reasons.push('Invoice referenced; allocating outstanding from larger deposit');
    }

    const nameScore = Math.max(
      nameOverlapScore(txn.counterpartyName ?? '', customerName),
      nameOverlapScore(txn.description ?? '', customerName),
    );
    scores.customerName = nameScore;
    if (nameScore >= 0.8) reasons.push('Customer name match');
    else if (nameScore >= 0.4) reasons.push('Partial customer name match');

    scores.description = nameOverlapScore(
      txn.description ?? '',
      `${customerName} ${candidate.invoiceNumber} ${candidate.title}`,
    );
    scores.date = dateProximityScore(txn.bookedDate, candidate.issueDate, candidate.dueDate);
    if (scores.date >= 0.7) reasons.push('Payment date close to invoice/due date');

    const confidence =
      scores.invoiceNumber * 0.34 +
      scores.reference * 0.12 +
      scores.amount * 0.28 +
      scores.customerName * 0.14 +
      scores.description * 0.04 +
      scores.date * 0.05 +
      scores.outstanding * 0.03;

    const identitySignal = scores.invoiceNumber + scores.reference + scores.customerName;
    let adjusted = confidence;
    // Exact amount + strong customer identity is enough for a reviewable suggestion
    if (scores.amount >= 1 && scores.customerName >= 0.8) {
      adjusted = Math.max(adjusted, MATCH_CONFIDENCE_MEDIUM + 0.05);
    }
    // Invoice number + allocatable amount is high-confidence signal
    if (scores.invoiceNumber >= 1 && scores.amount >= 0.85) {
      adjusted = Math.max(adjusted, MATCH_CONFIDENCE_HIGH);
    }
    if (identitySignal < 0.3 && scores.amount < 1) {
      adjusted = Math.min(adjusted, MATCH_CONFIDENCE_MEDIUM - 0.01);
    }
    if (identitySignal < 0.15 && scores.amount < 0.9) {
      adjusted = Math.min(adjusted, 0.4);
    }

    const band = bandForScore(adjusted);
    if (band === 'low' && adjusted < 0.35) continue;

    let matchMethod: MatchMethod = 'composite';
    if (scores.invoiceNumber >= 1 && scores.amount >= 0.9) matchMethod = 'invoice_number';
    else if (scores.reference >= 0.85 && scores.amount >= 0.9) matchMethod = 'reference';
    else if (scores.amount >= 1 && scores.customerName >= 0.8) matchMethod = 'exact_amount';
    else if (scores.customerName >= 0.8) matchMethod = 'customer_name';
    else if (scores.amount < 1 && scores.amount >= 0.55) matchMethod = 'partial_amount';

    const allocateAmount = Math.min(txn.amount, outstanding);

    suggestions.push({
      invoiceId: candidate.invoiceId,
      invoiceNumber: candidate.invoiceNumber,
      customerId: candidate.customerId,
      customerName,
      amount: Math.round(allocateAmount * 100) / 100,
      confidence: Math.round(adjusted * 1000) / 1000,
      confidenceBand: band,
      matchMethod,
      reasons,
      scores,
    });
  }

  suggestions.sort(
    (a, b) => b.confidence - a.confidence || a.invoiceNumber.localeCompare(b.invoiceNumber),
  );
  return suggestions;
}

/**
 * Pick auto-apply allocations for a high-confidence match.
 * Supports one transaction covering multiple invoices when amounts stack cleanly.
 */
export function selectAutoAllocations(
  txnAmount: number,
  suggestions: ScoredMatchSuggestion[],
): ScoredMatchSuggestion[] {
  const high = suggestions.filter((s) => s.confidenceBand === 'high');
  if (high.length === 0) return [];

  const exact = high.find(
    (s) => Math.abs(s.amount - txnAmount) < 0.005 && s.scores.amount >= 0.9,
  );
  if (exact) return [exact];

  const best = high[0];
  if (!best) return [];

  const sameCustomer = high.filter((s) => s.customerId === best.customerId);
  const stacked: ScoredMatchSuggestion[] = [];
  let remaining = txnAmount;
  for (const s of sameCustomer) {
    if (remaining <= 0.005) break;
    const take = Math.min(s.amount, remaining);
    if (take <= 0) continue;
    stacked.push({ ...s, amount: Math.round(take * 100) / 100 });
    remaining = Math.round((remaining - take) * 100) / 100;
  }
  if (stacked.length > 0 && remaining <= 0.05) return stacked;

  return [{ ...best, amount: Math.min(best.amount, txnAmount) }];
}

export function confidenceBandFromScore(score: number): MatchConfidenceBand {
  return bandForScore(score);
}
