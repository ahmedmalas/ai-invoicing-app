/**
 * Bank-feed persistence after Basiq retirement.
 * Connection / consent / mobile state is cleared; historical account/tx rows
 * may remain in the database but are not exposed as an active feed.
 */

import type {
  BankAccount,
  BankConnection,
  BankFeedStatusView,
  BankTransaction,
  ListBankTransactionsFilter,
} from '../domain/banking/types.js';
import { retiredBankFeedStatus } from '../domain/banking/retired.js';

export interface BankSqlDb {
  prepare(sql: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (...values: any[]) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all: (...values: any[]) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (...values: any[]) => any;
  };
}

export type CreateBankStoreOptions = {
  /** Postgres uses public.basiq_connect_states; SQLite uses basiq_connect_states. */
  connectStatesTable?: string;
};

export function createBankStore(db: BankSqlDb, options: CreateBankStoreOptions = {}) {
  const connectStatesTable = options.connectStatesTable ?? 'basiq_connect_states';

  return {
    /**
     * Wipe Basiq connection + CSRF state so mobile/consent cannot be reused.
     * Does not delete invoices, payments, or business profile rows.
     * Leaves bank_accounts / bank_transactions rows in place (orphaned history).
     */
    async clearRetiredProviderState(): Promise<{ cleared: true }> {
      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE bank_connections SET
            provider_connection_id = NULL,
            consent_id = NULL,
            consent_status = NULL,
            consent_started_at = NULL,
            consent_expires_at = NULL,
            auth_link_mobile = NULL,
            error_code = 'BANK_FEEDS_PROVIDER_RETIRED',
            error_message = 'Previous bank-feed provider retired',
            status = 'disconnected',
            updated_at = ?`,
        )
        .run(now);
      try {
        await db.prepare(`DELETE FROM ${connectStatesTable}`).run();
      } catch {
        // Connect-state table may be absent on fresh local DBs.
      }
      return { cleared: true };
    },

    async getConnectionByBusiness(businessId: string): Promise<BankConnection | null> {
      void businessId;
      return null;
    },

    async getConnectionById(businessId: string, id: string): Promise<BankConnection | null> {
      void businessId;
      void id;
      return null;
    },

    async listAccounts(businessId: string, activeOnly = false): Promise<BankAccount[]> {
      void businessId;
      void activeOnly;
      return [];
    },

    async listTransactions(
      filter: ListBankTransactionsFilter,
    ): Promise<{ items: BankTransaction[]; total: number }> {
      void filter;
      return { items: [], total: 0 };
    },

    async getFeedStatusView(businessId: string): Promise<BankFeedStatusView> {
      void businessId;
      return retiredBankFeedStatus();
    },
  };
}

export type BankStore = ReturnType<typeof createBankStore>;
