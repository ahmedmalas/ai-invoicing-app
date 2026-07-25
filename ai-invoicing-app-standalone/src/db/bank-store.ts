import { randomUUID } from 'node:crypto';

import { deriveBankConnectionStatus, nextActionForStatus } from '../domain/banking/status.js';
import type {
  BankAccount,
  BankConnection,
  BankConnectionStatus,
  BankFeedStatusView,
  BankProvider,
  BankTransaction,
  BankTransactionDirection,
  BasiqConnectState,
  ListBankTransactionsFilter,
} from '../domain/banking/types.js';
import { basiqConfigured } from '../services/basiq-client.js';

export interface BankSqlDb {
  // Looser prepare typing bridges better-sqlite3 and the postgres prepare shim.
  prepare(sql: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (...values: any[]) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all: (...values: any[]) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (...values: any[]) => any;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function mapConnection(row: Record<string, unknown>): BankConnection {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    provider: String(row.provider) as BankProvider,
    providerUserId: String(row.provider_user_id),
    providerConnectionId: (row.provider_connection_id as string | null) ?? null,
    status: String(row.status) as BankConnectionStatus,
    consentId: (row.consent_id as string | null) ?? null,
    consentStatus: (row.consent_status as string | null) ?? null,
    consentStartedAt: (row.consent_started_at as string | null) ?? null,
    consentExpiresAt: (row.consent_expires_at as string | null) ?? null,
    lastSyncAttemptAt: (row.last_sync_attempt_at as string | null) ?? null,
    lastSuccessfulSyncAt: (row.last_successful_sync_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAccount(row: Record<string, unknown>): BankAccount {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    bankConnectionId: String(row.bank_connection_id),
    providerAccountId: String(row.provider_account_id),
    institutionName: (row.institution_name as string | null) ?? null,
    accountName: (row.account_name as string | null) ?? null,
    maskedAccountNumber: (row.masked_account_number as string | null) ?? null,
    accountType: (row.account_type as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    currentBalance: row.current_balance == null ? null : Number(row.current_balance),
    availableBalance: row.available_balance == null ? null : Number(row.available_balance),
    balanceUpdatedAt: (row.balance_updated_at as string | null) ?? null,
    isActive: asBool(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTransaction(row: Record<string, unknown>): BankTransaction {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    bankAccountId: String(row.bank_account_id),
    providerTransactionId: String(row.provider_transaction_id),
    transactionDate: String(row.transaction_date),
    postedDate: (row.posted_date as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    amount: Number(row.amount),
    direction: String(row.direction) as BankTransactionDirection,
    status: (row.status as string | null) ?? null,
    merchantName: (row.merchant_name as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    providerCategory: (row.provider_category as string | null) ?? null,
    importedAt: String(row.imported_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createBankStore(
  db: BankSqlDb,
  options?: { connectStatesTable?: string },
) {
  const connectStatesTable = options?.connectStatesTable || 'basiq_connect_states';
  return {
    async getConnectionByBusiness(businessId: string): Promise<BankConnection | null> {
      const row = (await db
        .prepare(
          `SELECT * FROM bank_connections
           WHERE business_id = ?
           ORDER BY CASE WHEN status = 'disconnected' THEN 1 ELSE 0 END, updated_at DESC
           LIMIT 1`,
        )
        .get(businessId)) as Record<string, unknown> | undefined;
      return row ? mapConnection(row) : null;
    },

    async getConnectionById(
      businessId: string,
      connectionId: string,
    ): Promise<BankConnection | null> {
      const row = (await db
        .prepare('SELECT * FROM bank_connections WHERE id = ? AND business_id = ?')
        .get(connectionId, businessId)) as Record<string, unknown> | undefined;
      return row ? mapConnection(row) : null;
    },

    async upsertConnection(input: {
      id?: string | undefined;
      businessId: string;
      provider: BankProvider;
      providerUserId: string;
      providerConnectionId?: string | null | undefined;
      status: BankConnectionStatus;
      consentId?: string | null | undefined;
      consentStatus?: string | null | undefined;
      consentStartedAt?: string | null | undefined;
      consentExpiresAt?: string | null | undefined;
      lastSyncAttemptAt?: string | null | undefined;
      lastSuccessfulSyncAt?: string | null | undefined;
      errorCode?: string | null | undefined;
      errorMessage?: string | null | undefined;
    }): Promise<BankConnection> {
      const now = nowIso();
      const existing = await this.getConnectionByBusiness(input.businessId);
      const id = input.id ?? existing?.id ?? randomUUID();
      if (existing && existing.id === id) {
        await db
          .prepare(
            `UPDATE bank_connections SET
              provider = ?,
              provider_user_id = ?,
              provider_connection_id = ?,
              status = ?,
              consent_id = ?,
              consent_status = ?,
              consent_started_at = ?,
              consent_expires_at = ?,
              last_sync_attempt_at = COALESCE(?, last_sync_attempt_at),
              last_successful_sync_at = COALESCE(?, last_successful_sync_at),
              error_code = ?,
              error_message = ?,
              updated_at = ?
             WHERE id = ? AND business_id = ?`,
          )
          .run(
            input.provider,
            input.providerUserId,
            input.providerConnectionId ?? existing.providerConnectionId,
            input.status,
            input.consentId ?? existing.consentId,
            input.consentStatus ?? existing.consentStatus,
            input.consentStartedAt ?? existing.consentStartedAt,
            input.consentExpiresAt ?? existing.consentExpiresAt,
            input.lastSyncAttemptAt ?? null,
            input.lastSuccessfulSyncAt ?? null,
            input.errorCode ?? null,
            input.errorMessage ?? null,
            now,
            id,
            input.businessId,
          );
      } else {
        await db
          .prepare(
            `INSERT INTO bank_connections (
              id, business_id, provider, provider_user_id, provider_connection_id, status,
              consent_id, consent_status, consent_started_at, consent_expires_at,
              last_sync_attempt_at, last_successful_sync_at, error_code, error_message,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.businessId,
            input.provider,
            input.providerUserId,
            input.providerConnectionId ?? null,
            input.status,
            input.consentId ?? null,
            input.consentStatus ?? null,
            input.consentStartedAt ?? null,
            input.consentExpiresAt ?? null,
            input.lastSyncAttemptAt ?? null,
            input.lastSuccessfulSyncAt ?? null,
            input.errorCode ?? null,
            input.errorMessage ?? null,
            now,
            now,
          );
      }
      const saved = await this.getConnectionById(input.businessId, id);
      if (!saved) throw new Error('BANK_CONNECTION_UPSERT_FAILED');
      return saved;
    },

    async updateConnectionFields(
      businessId: string,
      connectionId: string,
      fields: Partial<{
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
      }>,
    ): Promise<BankConnection | null> {
      const existing = await this.getConnectionById(businessId, connectionId);
      if (!existing) return null;
      const now = nowIso();
      await db
        .prepare(
          `UPDATE bank_connections SET
            provider_connection_id = ?,
            status = ?,
            consent_id = ?,
            consent_status = ?,
            consent_started_at = ?,
            consent_expires_at = ?,
            last_sync_attempt_at = ?,
            last_successful_sync_at = ?,
            error_code = ?,
            error_message = ?,
            updated_at = ?
           WHERE id = ? AND business_id = ?`,
        )
        .run(
          fields.providerConnectionId !== undefined
            ? fields.providerConnectionId
            : existing.providerConnectionId,
          fields.status ?? existing.status,
          fields.consentId !== undefined ? fields.consentId : existing.consentId,
          fields.consentStatus !== undefined ? fields.consentStatus : existing.consentStatus,
          fields.consentStartedAt !== undefined
            ? fields.consentStartedAt
            : existing.consentStartedAt,
          fields.consentExpiresAt !== undefined
            ? fields.consentExpiresAt
            : existing.consentExpiresAt,
          fields.lastSyncAttemptAt !== undefined
            ? fields.lastSyncAttemptAt
            : existing.lastSyncAttemptAt,
          fields.lastSuccessfulSyncAt !== undefined
            ? fields.lastSuccessfulSyncAt
            : existing.lastSuccessfulSyncAt,
          fields.errorCode !== undefined ? fields.errorCode : existing.errorCode,
          fields.errorMessage !== undefined ? fields.errorMessage : existing.errorMessage,
          now,
          connectionId,
          businessId,
        );
      return this.getConnectionById(businessId, connectionId);
    },

    async listAccounts(businessId: string, activeOnly = false): Promise<BankAccount[]> {
      const rows = (await db
        .prepare(
          activeOnly
            ? `SELECT * FROM bank_accounts WHERE business_id = ? AND is_active = 1
               ORDER BY institution_name ASC, account_name ASC, id ASC`
            : `SELECT * FROM bank_accounts WHERE business_id = ?
               ORDER BY is_active DESC, institution_name ASC, account_name ASC, id ASC`,
        )
        .all(businessId)) as Array<Record<string, unknown>>;
      return rows.map(mapAccount);
    },

    async getAccountByProviderId(
      businessId: string,
      providerAccountId: string,
    ): Promise<BankAccount | null> {
      const row = (await db
        .prepare(
          'SELECT * FROM bank_accounts WHERE business_id = ? AND provider_account_id = ?',
        )
        .get(businessId, providerAccountId)) as Record<string, unknown> | undefined;
      return row ? mapAccount(row) : null;
    },

    async upsertAccount(input: {
      businessId: string;
      bankConnectionId: string;
      providerAccountId: string;
      institutionName?: string | null;
      accountName?: string | null;
      maskedAccountNumber?: string | null;
      accountType?: string | null;
      currency?: string | null;
      currentBalance?: number | null;
      availableBalance?: number | null;
      balanceUpdatedAt?: string | null;
      isActive?: boolean;
    }): Promise<{ account: BankAccount; created: boolean }> {
      const existing = await this.getAccountByProviderId(input.businessId, input.providerAccountId);
      const now = nowIso();
      if (existing) {
        await db
          .prepare(
            `UPDATE bank_accounts SET
              bank_connection_id = ?,
              institution_name = ?,
              account_name = ?,
              masked_account_number = ?,
              account_type = ?,
              currency = ?,
              current_balance = ?,
              available_balance = ?,
              balance_updated_at = ?,
              is_active = ?,
              updated_at = ?
             WHERE id = ? AND business_id = ?`,
          )
          .run(
            input.bankConnectionId,
            input.institutionName ?? existing.institutionName,
            input.accountName ?? existing.accountName,
            input.maskedAccountNumber ?? existing.maskedAccountNumber,
            input.accountType ?? existing.accountType,
            input.currency ?? existing.currency,
            input.currentBalance ?? existing.currentBalance,
            input.availableBalance ?? existing.availableBalance,
            input.balanceUpdatedAt ?? existing.balanceUpdatedAt,
            input.isActive === false ? 0 : 1,
            now,
            existing.id,
            input.businessId,
          );
        const account = await this.getAccountByProviderId(
          input.businessId,
          input.providerAccountId,
        );
        if (!account) throw new Error('BANK_ACCOUNT_UPSERT_FAILED');
        return { account, created: false };
      }
      const id = randomUUID();
      await db
        .prepare(
          `INSERT INTO bank_accounts (
            id, business_id, bank_connection_id, provider_account_id, institution_name,
            account_name, masked_account_number, account_type, currency, current_balance,
            available_balance, balance_updated_at, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.businessId,
          input.bankConnectionId,
          input.providerAccountId,
          input.institutionName ?? null,
          input.accountName ?? null,
          input.maskedAccountNumber ?? null,
          input.accountType ?? null,
          input.currency ?? null,
          input.currentBalance ?? null,
          input.availableBalance ?? null,
          input.balanceUpdatedAt ?? null,
          input.isActive === false ? 0 : 1,
          now,
          now,
        );
      const account = await this.getAccountByProviderId(input.businessId, input.providerAccountId);
      if (!account) throw new Error('BANK_ACCOUNT_UPSERT_FAILED');
      return { account, created: true };
    },

    async markAccountsInactiveExcept(
      businessId: string,
      bankConnectionId: string,
      activeProviderAccountIds: string[],
    ): Promise<void> {
      // Do not delete — incomplete provider payloads must not wipe accounts.
      const accounts = await this.listAccounts(businessId, false);
      const keep = new Set(activeProviderAccountIds);
      const now = nowIso();
      for (const account of accounts) {
        if (account.bankConnectionId !== bankConnectionId) continue;
        if (keep.has(account.providerAccountId)) continue;
        if (!account.isActive) continue;
        await db
          .prepare(
            `UPDATE bank_accounts SET is_active = 0, updated_at = ?
             WHERE id = ? AND business_id = ?`,
          )
          .run(now, account.id, businessId);
      }
    },

    async upsertTransaction(input: {
      businessId: string;
      bankAccountId: string;
      providerTransactionId: string;
      transactionDate: string;
      postedDate?: string | null;
      description?: string | null;
      amount: number;
      direction: BankTransactionDirection;
      status?: string | null;
      merchantName?: string | null;
      reference?: string | null;
      providerCategory?: string | null;
    }): Promise<{ created: boolean }> {
      const existing = (await db
        .prepare(
          `SELECT id FROM bank_transactions
           WHERE business_id = ? AND provider_transaction_id = ?`,
        )
        .get(input.businessId, input.providerTransactionId)) as { id: string } | undefined;
      const now = nowIso();
      if (existing) {
        await db
          .prepare(
            `UPDATE bank_transactions SET
              bank_account_id = ?,
              transaction_date = ?,
              posted_date = ?,
              description = ?,
              amount = ?,
              direction = ?,
              status = ?,
              merchant_name = ?,
              reference = ?,
              provider_category = ?,
              updated_at = ?
             WHERE id = ? AND business_id = ?`,
          )
          .run(
            input.bankAccountId,
            input.transactionDate,
            input.postedDate ?? null,
            input.description ?? null,
            input.amount,
            input.direction,
            input.status ?? null,
            input.merchantName ?? null,
            input.reference ?? null,
            input.providerCategory ?? null,
            now,
            existing.id,
            input.businessId,
          );
        return { created: false };
      }
      await db
        .prepare(
          `INSERT INTO bank_transactions (
            id, business_id, bank_account_id, provider_transaction_id, transaction_date,
            posted_date, description, amount, direction, status, merchant_name, reference,
            provider_category, imported_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.businessId,
          input.bankAccountId,
          input.providerTransactionId,
          input.transactionDate,
          input.postedDate ?? null,
          input.description ?? null,
          input.amount,
          input.direction,
          input.status ?? null,
          input.merchantName ?? null,
          input.reference ?? null,
          input.providerCategory ?? null,
          now,
          now,
          now,
        );
      return { created: true };
    },

    async listTransactions(filter: ListBankTransactionsFilter): Promise<{
      items: BankTransaction[];
      total: number;
    }> {
      const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
      const offset = Math.max(filter.offset ?? 0, 0);
      const params: unknown[] = [filter.businessId];
      let where = 'business_id = ?';
      if (filter.accountId) {
        where += ' AND bank_account_id = ?';
        params.push(filter.accountId);
      }
      if (filter.search?.trim()) {
        where +=
          ' AND (lower(coalesce(description, \'\')) LIKE ? OR lower(coalesce(merchant_name, \'\')) LIKE ? OR lower(coalesce(reference, \'\')) LIKE ?)';
        const wildcard = `%${filter.search.trim().toLowerCase()}%`;
        params.push(wildcard, wildcard, wildcard);
      }
      const countRow = (await db
        .prepare(`SELECT COUNT(*) AS c FROM bank_transactions WHERE ${where}`)
        .get(...params)) as { c: number };
      const rows = (await db
        .prepare(
          `SELECT * FROM bank_transactions
           WHERE ${where}
           ORDER BY transaction_date DESC, posted_date DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset)) as Array<Record<string, unknown>>;
      return { items: rows.map(mapTransaction), total: Number(countRow?.c || 0) };
    },

    async listRecentTransactions(
      businessId: string,
      limit = 5,
    ): Promise<BankTransaction[]> {
      const result = await this.listTransactions({ businessId, limit, offset: 0 });
      return result.items;
    },

    async saveConnectState(state: BasiqConnectState): Promise<void> {
      await db
        .prepare(
          `INSERT INTO ${connectStatesTable} (
            state_token, workspace_id, workspace_schema, business_id,
            provider_user_id, bank_connection_id, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(state_token) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            workspace_schema = excluded.workspace_schema,
            business_id = excluded.business_id,
            provider_user_id = excluded.provider_user_id,
            bank_connection_id = excluded.bank_connection_id,
            expires_at = excluded.expires_at`,
        )
        .run(
          state.stateToken,
          state.workspaceId,
          state.workspaceSchema,
          state.businessId,
          state.providerUserId,
          state.bankConnectionId,
          state.expiresAt,
          state.createdAt,
        );
    },

    async consumeConnectState(stateToken: string): Promise<BasiqConnectState | null> {
      const row = (await db
        .prepare(`SELECT * FROM ${connectStatesTable} WHERE state_token = ?`)
        .get(stateToken)) as Record<string, unknown> | undefined;
      if (!row) return null;
      await db
        .prepare(`DELETE FROM ${connectStatesTable} WHERE state_token = ?`)
        .run(stateToken);
      const expiresAt = String(row.expires_at);
      if (Date.parse(expiresAt) < Date.now()) return null;
      return {
        stateToken: String(row.state_token),
        workspaceId: String(row.workspace_id),
        workspaceSchema: String(row.workspace_schema),
        businessId: String(row.business_id),
        providerUserId: (row.provider_user_id as string | null) ?? null,
        bankConnectionId: (row.bank_connection_id as string | null) ?? null,
        expiresAt,
        createdAt: String(row.created_at),
      };
    },

    async getFeedStatusView(businessId: string): Promise<BankFeedStatusView> {
      const configured = basiqConfigured();
      const connection = await this.getConnectionByBusiness(businessId);
      const accounts = connection ? await this.listAccounts(businessId, true) : [];
      if (!configured && !connection) {
        return {
          implemented: true,
          configured: false,
          connected: false,
          status: 'not_configured',
          provider: null,
          institution: null,
          maskedAccount: null,
          accounts: [],
          lastSuccessfulSyncAt: null,
          lastSyncAttemptAt: null,
          consentExpiresAt: null,
          errors: [],
          warning: 'BASIQ_API_KEY is not configured on the server.',
          nextAction: 'Ask an administrator to set BASIQ_API_KEY in Vercel (server-only).',
          distinction: {
            featureAbsent: false,
            toolAbsentForExistingFeature: false,
            permissionDenied: false,
            providerDisconnected: true,
            temporaryFailure: false,
          },
        };
      }
      if (!connection || connection.status === 'disconnected' || connection.status === 'not_connected') {
        return {
          implemented: true,
          configured,
          connected: false,
          status: 'not_connected',
          provider: 'basiq',
          institution: null,
          maskedAccount: null,
          accounts: [],
          lastSuccessfulSyncAt: null,
          lastSyncAttemptAt: null,
          consentExpiresAt: null,
          errors: [],
          warning: null,
          nextAction: nextActionForStatus('not_connected'),
          distinction: {
            featureAbsent: false,
            toolAbsentForExistingFeature: false,
            permissionDenied: false,
            providerDisconnected: true,
            temporaryFailure: false,
          },
        };
      }
      const status = deriveBankConnectionStatus(connection);
      const primary = accounts[0] || null;
      const errors: string[] = [];
      if (connection.errorMessage) errors.push(connection.errorMessage);
      return {
        implemented: true,
        configured,
        connected: status !== 'disconnected' && status !== 'not_connected' && status !== 'error',
        status,
        provider: connection.provider,
        institution: primary?.institutionName || null,
        maskedAccount: primary?.maskedAccountNumber || null,
        accounts: accounts.map((account) => ({
          id: account.id,
          institutionName: account.institutionName,
          accountName: account.accountName,
          maskedAccountNumber: account.maskedAccountNumber,
          accountType: account.accountType,
          isActive: account.isActive,
        })),
        lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
        lastSyncAttemptAt: connection.lastSyncAttemptAt,
        consentExpiresAt: connection.consentExpiresAt,
        errors,
        warning:
          status === 'consent_expiring'
            ? 'Open-banking consent is expiring soon.'
            : status === 'connected_delayed'
              ? 'Last successful sync is delayed.'
              : status === 'reauth_required'
                ? 'Reauthentication is required.'
                : null,
        nextAction: nextActionForStatus(status),
        distinction: {
          featureAbsent: false,
          toolAbsentForExistingFeature: false,
          permissionDenied: false,
          providerDisconnected: status === 'disconnected' || status === 'reauth_required',
          temporaryFailure: status === 'provider_unavailable' || status === 'error',
        },
      };
    },
  };
}

export type BankStore = ReturnType<typeof createBankStore>;
