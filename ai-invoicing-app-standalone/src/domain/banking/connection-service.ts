import { randomBytes, randomUUID } from 'node:crypto';

import type { BankStore } from '../../db/bank-store.js';
import {
  BasiqClientError,
  basiqConfigured,
  createBasiqAuthLink,
  createBasiqUser,
  deleteBasiqConnection,
} from '../../services/basiq-client.js';
import { syncBankConnection } from './sync-service.js';
import type { BankConnection, BankSyncResult } from './types.js';

const STATE_TTL_MS = 30 * 60 * 1000;
export const BASIQ_STATE_COOKIE = 'aleya_basiq_state';

export function createConnectStateToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function startBasiqConnect(
  store: BankStore,
  input: {
    businessId: string;
    workspaceId: string;
    workspaceSchema: string;
    email: string;
    mobile?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<{
  authLinkUrl: string;
  stateToken: string;
  connection: BankConnection;
  expiresAt: string | null;
}> {
  if (!basiqConfigured()) {
    throw new BasiqClientError('not_configured', 'BASIQ_API_KEY is not configured');
  }
  if (!input.email?.trim()) {
    throw new Error('BANK_CONNECT_EMAIL_REQUIRED');
  }
  if (!input.mobile?.trim()) {
    throw new Error('BANK_CONNECT_MOBILE_REQUIRED');
  }

  const existing = await store.getConnectionByBusiness(input.businessId);
  let providerUserId = existing?.providerUserId;
  if (!providerUserId || existing?.status === 'disconnected') {
    const userInput: {
      email: string;
      mobile: string;
      firstName?: string | null;
      lastName?: string | null;
    } = {
      email: input.email.trim(),
      mobile: input.mobile.trim(),
    };
    if (input.firstName) userInput.firstName = input.firstName;
    if (input.lastName) userInput.lastName = input.lastName;
    const created = await createBasiqUser(userInput);
    providerUserId = created.id;
  }

  const upsertInput: Parameters<BankStore['upsertConnection']>[0] = {
    businessId: input.businessId,
    provider: 'basiq',
    providerUserId,
    providerConnectionId: existing?.providerConnectionId ?? null,
    status: 'connecting',
    consentStartedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
  };
  if (existing && existing.status !== 'disconnected') {
    upsertInput.id = existing.id;
  }
  const connection = await store.upsertConnection(upsertInput);

  const authLink = await createBasiqAuthLink(providerUserId);
  const stateToken = createConnectStateToken();
  const now = new Date();
  await store.saveConnectState({
    stateToken,
    workspaceId: input.workspaceId,
    workspaceSchema: input.workspaceSchema,
    businessId: input.businessId,
    providerUserId,
    bankConnectionId: connection.id,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  });

  return {
    authLinkUrl: authLink.publicUrl,
    stateToken,
    connection,
    expiresAt: authLink.expiresAt,
  };
}

export async function completeBasiqCallback(
  store: BankStore,
  input: {
    stateToken: string;
    cookieState?: string | null;
  },
): Promise<{
  workspaceId: string;
  workspaceSchema: string;
  businessId: string;
  sync: BankSyncResult;
}> {
  if (!input.cookieState || input.cookieState !== input.stateToken) {
    throw new Error('BANK_CONNECT_STATE_MISMATCH');
  }
  const state = await store.consumeConnectState(input.stateToken);
  if (!state) {
    throw new Error('BANK_CONNECT_STATE_INVALID');
  }
  const connectionId = state.bankConnectionId || randomUUID();
  let connection = await store.getConnectionById(state.businessId, connectionId);
  if (!connection) {
    connection = await store.upsertConnection({
      id: connectionId,
      businessId: state.businessId,
      provider: 'basiq',
      providerUserId: state.providerUserId || 'unknown',
      status: 'connecting',
    });
  } else {
    await store.updateConnectionFields(state.businessId, connection.id, {
      status: 'connecting',
      errorCode: null,
      errorMessage: null,
    });
  }

  const sync = await syncBankConnection(store, {
    businessId: state.businessId,
    connectionId: connection.id,
    triggerRefresh: false,
  });

  return {
    workspaceId: state.workspaceId,
    workspaceSchema: state.workspaceSchema,
    businessId: state.businessId,
    sync,
  };
}

export async function disconnectBankFeed(
  store: BankStore,
  input: {
    businessId: string;
    confirmed: boolean;
  },
): Promise<BankConnection> {
  if (!input.confirmed) {
    throw new Error('BANK_DISCONNECT_CONFIRMATION_REQUIRED');
  }
  const connection = await store.getConnectionByBusiness(input.businessId);
  if (!connection || connection.status === 'disconnected') {
    throw new Error('BANK_CONNECTION_NOT_FOUND');
  }
  if (connection.providerConnectionId) {
    try {
      await deleteBasiqConnection(connection.providerUserId, connection.providerConnectionId);
    } catch (error) {
      // Persist local disconnect even if provider delete fails (already revoked, etc.).
      if (!(error instanceof BasiqClientError && error.category === 'not_found')) {
        await store.updateConnectionFields(input.businessId, connection.id, {
          status: 'error',
          errorCode: error instanceof BasiqClientError ? error.category : 'provider_error',
          errorMessage: 'Provider disconnect failed; local disconnect not completed.',
        });
        throw error;
      }
    }
  }
  const updated = await store.updateConnectionFields(input.businessId, connection.id, {
    status: 'disconnected',
    providerConnectionId: null,
    errorCode: null,
    errorMessage: null,
  });
  if (!updated) throw new Error('BANK_CONNECTION_NOT_FOUND');
  return updated;
}
