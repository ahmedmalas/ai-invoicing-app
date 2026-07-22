export type AccountType =
  | 'Asset'
  | 'Liability'
  | 'Equity'
  | 'Income'
  | 'CostOfSales'
  | 'Expense';

export type AccountCategory =
  | 'Current Asset'
  | 'Non-Current Asset'
  | 'Current Liability'
  | 'Non-Current Liability'
  | 'Equity'
  | 'Income'
  | 'Cost of Sales'
  | 'Expense';

export type GstDefault = 'GST' | 'GST_FREE' | 'INPUT' | 'CAPITAL' | 'NONE';

export type FinancialYearStatus = 'Open' | 'Closed';
export type AccountingPeriodStatus = 'Open' | 'Locked' | 'Closed';
export type JournalStatus = 'Draft' | 'Approved' | 'Posted' | 'Reversed';
export type JournalSource = 'Manual' | 'Auto' | 'Reversal';

export interface ChartAccount {
  id: string;
  accountNumber: string;
  name: string;
  accountType: AccountType;
  category: AccountCategory;
  gstDefault: GstDefault;
  isActive: boolean;
  isArchived: boolean;
  isSystem: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: FinancialYearStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingPeriod {
  id: string;
  financialYearId: string;
  label: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLineInput {
  accountId: string;
  description?: string | null | undefined;
  debit: number;
  credit: number;
  gstAmount?: number | null | undefined;
  gstCode?: GstDefault | null | undefined;
}

export interface JournalLine extends JournalLineInput {
  id: string;
  journalId: string;
  lineNumber: number;
  accountNumber?: string;
  accountName?: string;
}

export interface Journal {
  id: string;
  journalNumber: string | null;
  status: JournalStatus;
  source: JournalSource;
  journalDate: string;
  periodId: string | null;
  narration: string;
  notes: string | null;
  reference: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  postedByUserId: string | null;
  reversedByJournalId: string | null;
  reversesJournalId: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  postedAt: string | null;
  lines?: JournalLine[];
}

export interface JournalAttachment {
  id: string;
  journalId: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
  createdAt: string;
}

export interface AccountingAuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface LedgerEntry {
  journalId: string;
  journalNumber: string | null;
  journalDate: string;
  narration: string;
  lineDescription: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  status: JournalStatus;
}

export interface TrialBalanceRow {
  accountId: string;
  accountNumber: string;
  name: string;
  accountType: AccountType;
  debit: number;
  credit: number;
}

export interface ProfitAndLossSection {
  label: string;
  rows: Array<{ accountNumber: string; name: string; amount: number }>;
  total: number;
}

export interface ProfitAndLossReport {
  from: string;
  to: string;
  income: ProfitAndLossSection;
  costOfSales: ProfitAndLossSection;
  grossProfit: number;
  expenses: ProfitAndLossSection;
  netProfit: number;
}

export interface BalanceSheetSection {
  label: string;
  rows: Array<{ accountNumber: string; name: string; amount: number }>;
  total: number;
}

export interface BalanceSheetReport {
  asAt: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  netAssets: number;
}

export interface GstDetailRow {
  journalId: string;
  journalNumber: string | null;
  journalDate: string;
  accountNumber: string;
  accountName: string;
  gstCode: GstDefault;
  netAmount: number;
  gstAmount: number;
  grossAmount: number;
}

export interface GstSummaryReport {
  from: string;
  to: string;
  salesGst: number;
  purchasesGst: number;
  netGst: number;
  gstFreeSales: number;
  detailCount: number;
}

export interface BasReport {
  from: string;
  to: string;
  /** G1 Total sales (including GST) */
  G1: number;
  /** G2 Export sales */
  G2: number;
  /** G3 Other GST-free sales */
  G3: number;
  /** 1A GST on sales */
  '1A': number;
  /** 1B GST on purchases */
  '1B': number;
  netGst: number;
}

export type AgeingBucket = 'Current' | '30' | '60' | '90' | '120+';

export interface AgeingRow {
  partyId: string;
  partyName: string;
  documentId: string;
  documentNumber: string;
  dueDate: string;
  outstanding: number;
  bucket: AgeingBucket;
}

export interface AgeingReport {
  asAt: string;
  buckets: Record<AgeingBucket, number>;
  rows: AgeingRow[];
  total: number;
}

export interface AccountingDashboard {
  bankBalance: number;
  gstPayable: number;
  gstReceivable: number;
  receivables: number;
  payables: number;
  netProfit: number;
  cashFlow: number;
  financialYearLabel: string | null;
  overdueInvoices: number;
  overdueSupplierBills: number;
}
