import type { BankStore } from '../../db/bank-store.js';
import {
  BasiqClientError,
  listBasiqAccounts,
  listBasiqConnections,
  listBasiqTransactions,
  refreshBasiqConnection,
} from '../../services/basiq-client.js';
import { maskAccountNumber, mapProviderConnectionStatus } from './status.js';
import type { BankSyncResult, BankTransactionDirection } from './types.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function directionFromAmount(amount: number, raw?: string | null): BankTransactionDirection {
  if (raw === 'credit' || raw === 'debit') return raw;
  if (amount > 0) return 'credit';
  if (amount < 0) return 'debit';
  return 'unknown';
}

function institutionFromAccount(account: Record<string, unknown>): string | null {
  const institution = asRecord(account.institution);
  return (
    pickString(institution.name, institution.shortName, account.institutionName) || 'Connected bank'
  );
}

/**
 * Idempotent account + transaction import for one business connection.
 * Incomplete provider payloads never delete existing rows.
 */
export async function syncBankConnection(
  store: BankStore,
  input: {
    businessId: string;
    connectionId: string;
    triggerRefresh?: boolean;
  },
): Promise<BankSyncResult> {
  const connection = await store.getConnectionById(input.businessId, input.connectionId);
  if (!connection) {
    throw new Error('BANK_CONNECTION_NOT_FOUND');
  }

  const attemptAt = new Date().toISOString();
  await store.updateConnectionFields(input.businessId, connection.id, {
    status: 'syncing',
    lastSyncAttemptAt: attemptAt,
    errorCode: null,
    errorMessage: null,
  });

  const partialFailures: string[] = [];
  let accountsUpserted = 0;
  let transactionsUpserted = 0;
  let transactionsSkippedDuplicate = 0;

  try {
    if (input.triggerRefresh && connection.providerConnectionId) {
      try {
        await refreshBasiqConnection(connection.providerUserId, connection.providerConnectionId);
      } catch (error) {
        const category = error instanceof BasiqClientError ? error.category : 'provider_error';
        partialFailures.push(`refresh:${category}`);
      }
    }

    const providerConnections = await listBasiqConnections(connection.providerUserId);
    const primary = asRecord(providerConnections[0]);
    const providerConnectionId =
      pickString(primary.id, connection.providerConnectionId) || connection.providerConnectionId;
    const mappedStatus = mapProviderConnectionStatus(pickString(primary.status));
    const consent = asRecord(primary.consent || primary);
    await store.updateConnectionFields(input.businessId, connection.id, {
      providerConnectionId,
      status: 'syncing',
      consentId: pickString(consent.id, connection.consentId),
      consentStatus: pickString(consent.status, connection.consentStatus),
      consentExpiresAt: pickString(
        consent.expiresAt,
        consent.expiry,
        connection.consentExpiresAt,
      ),
    });

    const providerAccounts = await listBasiqAccounts(connection.providerUserId);
    const activeProviderIds: string[] = [];
    const accountIdByProvider = new Map<string, string>();

    for (const raw of providerAccounts) {
      const account = asRecord(raw);
      const providerAccountId = pickString(account.id);
      if (!providerAccountId) continue;
      activeProviderIds.push(providerAccountId);
      const balance = asRecord(account.balance);
      const masked =
        maskAccountNumber(
          pickString(account.accountNo, account.accountNumber, account.maskedNumber),
        ) || pickString(account.accountNo);
      const { account: saved } = await store.upsertAccount({
        businessId: input.businessId,
        bankConnectionId: connection.id,
        providerAccountId,
        institutionName: institutionFromAccount(account),
        accountName: pickString(account.name, account.accountHolder),
        maskedAccountNumber: masked,
        accountType: pickString(account.class, account.accountType, account.type),
        currency: pickString(balance.currency, account.currency) || 'AUD',
        currentBalance: pickNumber(balance.current, account.balance),
        availableBalance: pickNumber(balance.available, balance.current),
        balanceUpdatedAt: pickString(account.lastUpdated, balance.asAt) || attemptAt,
        isActive: true,
      });
      accountIdByProvider.set(providerAccountId, saved.id);
      accountsUpserted += 1;
    }

    if (activeProviderIds.length > 0) {
      await store.markAccountsInactiveExcept(
        input.businessId,
        connection.id,
        activeProviderIds,
      );
    }

    let next: string | null | undefined;
    let pages = 0;
    const maxPages = 20;
    do {
      pages += 1;
      const page = await listBasiqTransactions(connection.providerUserId, {
        limit: 500,
        ...(next ? { next } : {}),
      });
      for (const raw of page.data) {
        const tx = asRecord(raw);
        const providerTransactionId = pickString(tx.id);
        if (!providerTransactionId) continue;
        const accountRef = asRecord(tx.account);
        const providerAccountId = pickString(accountRef.id, tx.accountId, tx.account);
        const bankAccountId = providerAccountId
          ? accountIdByProvider.get(providerAccountId)
          : undefined;
        if (!bankAccountId) {
          partialFailures.push('transaction_missing_account');
          continue;
        }
        const amount = pickNumber(tx.amount, tx.transactionAmount) ?? 0;
        const direction = directionFromAmount(
          amount,
          pickString(tx.direction, tx.creditDebit) as 'credit' | 'debit' | null,
        );
        // Treat provider text as untrusted display data only — never execute/follow it.
        const description = pickString(tx.description, tx.rawText, tx.narrative);
        const result = await store.upsertTransaction({
          businessId: input.businessId,
          bankAccountId,
          providerTransactionId,
          transactionDate:
            pickString(tx.postDate, tx.transactionDate, tx.postedDate, tx.date) ||
            attemptAt.slice(0, 10),
          postedDate: pickString(tx.postDate, tx.postedDate),
          description,
          amount: Math.abs(amount),
          direction,
          status: pickString(tx.status) || 'posted',
          merchantName: pickString(asRecord(tx.merchant).name, tx.merchantName),
          reference: pickString(tx.reference, tx.rawReference),
          providerCategory: pickString(
            asRecord(tx.category).name,
            asRecord(tx.class).title,
            tx.category,
          ),
        });
        if (result.created) transactionsUpserted += 1;
        else transactionsSkippedDuplicate += 1;
      }
      next = page.next || null;
    } while (next && pages < maxPages);

    const successAt = new Date().toISOString();
    const finalStatus =
      mappedStatus === 'connected' || mappedStatus === 'connecting'
        ? mappedStatus === 'connecting' && accountsUpserted === 0
          ? 'connecting'
          : 'connected'
        : mappedStatus;

    await store.updateConnectionFields(input.businessId, connection.id, {
      status: finalStatus,
      lastSuccessfulSyncAt: successAt,
      errorCode: partialFailures.length ? 'partial_sync' : null,
      errorMessage: partialFailures.length
        ? `Partial sync: ${[...new Set(partialFailures)].slice(0, 5).join(', ')}`
        : null,
    });

    return {
      connectionId: connection.id,
      accountsUpserted,
      transactionsUpserted,
      transactionsSkippedDuplicate,
      partialFailures: [...new Set(partialFailures)],
      lastSuccessfulSyncAt: successAt,
      status: finalStatus,
    };
  } catch (error) {
    const category = error instanceof BasiqClientError ? error.category : 'provider_error';
    const status =
      category === 'network' || category === 'timeout' || category === 'rate_limited'
        ? 'provider_unavailable'
        : category === 'auth_failed'
          ? 'reauth_required'
          : 'error';
    await store.updateConnectionFields(input.businessId, connection.id, {
      status,
      errorCode: category,
      errorMessage: 'Bank sync failed. Provider details omitted for safety.',
    });
    throw error;
  }
}
