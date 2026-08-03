/** Bank-feed domain types (provider-neutral after Basiq retirement). */

export type BankProvider = 'basiq' | 'none';

export type BankConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'connected_delayed'
  | 'consent_expiring'
  | 'reauth_required'
  | 'provider_unavailable'
  | 'disconnected'
  | 'error';

export type BankTransactionDirection = 'credit' | 'debit' | 'unknown';

export interface BankConnection {
  id: string;
  businessId: string;
  provider: BankProvider;
  providerUserId: string;
  providerConnectionId: string | null;
  status: BankConnectionStatus;
  consentId: string | null;
  consentStatus: string | null;
  consentStartedAt: string | null;
  consentExpiresAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Retired Basiq AuthLink mobile — cleared on provider retirement. */
  authLinkMobile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccount {
  id: string;
  businessId: string;
  bankConnectionId: string;
  providerAccountId: string;
  institutionName: string | null;
  accountName: string | null;
  maskedAccountNumber: string | null;
  accountType: string | null;
  currency: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  balanceUpdatedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransaction {
  id: string;
  businessId: string;
  bankAccountId: string;
  providerTransactionId: string;
  transactionDate: string;
  postedDate: string | null;
  description: string | null;
  amount: number;
  direction: BankTransactionDirection;
  status: string | null;
  merchantName: string | null;
  reference: string | null;
  providerCategory: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Basiq connect CSRF state — table retained empty after retirement. */
export interface BasiqConnectState {
  stateToken: string;
  workspaceId: string;
  workspaceSchema: string;
  businessId: string;
  providerUserId: string | null;
  bankConnectionId: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface BankSyncResult {
  connectionId: string;
  accountsUpserted: number;
  transactionsUpserted: number;
  transactionsSkippedDuplicate: number;
  partialFailures: string[];
  lastSuccessfulSyncAt: string | null;
  status: BankConnectionStatus;
}

export interface ListBankTransactionsFilter {
  businessId: string;
  accountId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BankFeedStatusView {
  implemented: boolean;
  configured: boolean;
  connected: boolean;
  status: BankConnectionStatus | 'not_configured' | 'not_connected';
  provider: BankProvider | null;
  environment: 'sandbox' | 'production' | null;
  sandbox: boolean;
  authLinkDelivery: 'open_auth_link' | 'consent_ui_connect' | null;
  authLinkMobileMasked: string | null;
  redirectUrlRequired: string | null;
  institution: string | null;
  maskedAccount: string | null;
  accounts: Array<{
    id: string;
    institutionName: string | null;
    accountName: string | null;
    maskedAccountNumber: string | null;
    accountType: string | null;
    isActive: boolean;
  }>;
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  consentExpiresAt: string | null;
  errorCode: string | null;
  errors: string[];
  warning: string | null;
  nextAction: string | null;
  distinction: {
    featureAbsent: boolean;
    toolAbsentForExistingFeature: boolean;
    permissionDenied: boolean;
    providerDisconnected: boolean;
    temporaryFailure: boolean;
  };
  /** True after the previous provider integration was retired. */
  retired?: boolean;
  code?: string;
}
