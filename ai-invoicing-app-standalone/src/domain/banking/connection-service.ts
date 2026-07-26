import { randomBytes, randomUUID } from 'node:crypto';

import type { BankStore } from '../../db/bank-store.js';
import {
  BasiqClientError,
  basiqConfigured,
  createBasiqAuthLink,
  createBasiqUser,
  deleteBasiqConnection,
  getBasiqUser,
  isBasiqSandboxEnvironment,
  updateBasiqUser,
} from '../../services/basiq-client.js';
import {
  InvalidAustralianMobileError,
  isBasiqPlaceholderMobile,
  maskAustralianMobileE164,
  mobileEndingDigits,
  normalizeAustralianMobileE164,
} from './phone.js';
import { syncBankConnection } from './sync-service.js';
import type { BankConnection, BankSyncResult } from './types.js';

const STATE_TTL_MS = 30 * 60 * 1000;
export const BASIQ_STATE_COOKIE = 'aleya_basiq_state';

export type AuthLinkDeliveryMode = 'open_auth_link';

export function createConnectStateToken(): string {
  return randomBytes(24).toString('base64url');
}

function logSafeMobileDiag(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      service: 'basiq-connect',
      event,
      ...payload,
    }),
  );
}

export async function startBasiqConnect(
  store: BankStore,
  input: {
    businessId: string;
    workspaceId: string;
    workspaceSchema: string;
    email: string;
    mobile?: string | null;
    /** Previously confirmed AuthLink mobile (E.164) from Aleya storage. */
    storedMobile?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    /** Force collecting/using a newly supplied mobile (Change mobile). */
    changeMobile?: boolean;
  },
): Promise<{
  authLinkUrl: string;
  stateToken: string;
  connection: BankConnection;
  expiresAt: string | null;
  environment: 'sandbox' | 'production';
  deliveryMode: AuthLinkDeliveryMode;
  sandbox: boolean;
  /** Full E.164 for server persistence only — never send to browser clients. */
  authLinkMobile: string;
  /** Safe for UI / API responses. */
  authLinkMobileMasked: string;
  message: string;
}> {
  if (!basiqConfigured()) {
    throw new BasiqClientError('not_configured', 'BASIQ_API_KEY is not configured');
  }
  if (!input.email?.trim()) {
    throw new Error('BANK_CONNECT_EMAIL_REQUIRED');
  }

  const sandbox = isBasiqSandboxEnvironment();
  const existing = await store.getConnectionByBusiness(input.businessId);
  // AuthLink hosted 2FA always needs a real AU mobile (sandbox and production).
  // Basiq docs: auth_link.mobile overrides the User mobile for SMS 2FA.
  // Reconnect/resend prefer: new input → previously confirmed stored mobile → (caller may pass profile phone as input.mobile).
  const stored =
    input.storedMobile ||
    (existing?.authLinkMobile && !isBasiqPlaceholderMobile(existing.authLinkMobile)
      ? existing.authLinkMobile
      : null);
  const candidate = input.changeMobile ? input.mobile : input.mobile || stored || null;
  const mobileForApi = normalizeAustralianMobileE164(candidate);
  if (!mobileForApi) {
    throw new InvalidAustralianMobileError(
      'A valid Australian mobile (+614XXXXXXXX) is required for Basiq AuthLink SMS verification.',
    );
  }
  const mobileMasked = maskAustralianMobileE164(mobileForApi);
  if (!mobileMasked) {
    throw new InvalidAustralianMobileError();
  }

  let providerUserId = existing?.providerUserId;
  if (!providerUserId || existing?.status === 'disconnected') {
    const userInput: {
      email: string;
      mobile: string;
      firstName?: string | null;
      lastName?: string | null;
    } = {
      email: input.email.trim(),
      mobile: mobileForApi,
    };
    if (input.firstName) userInput.firstName = input.firstName;
    if (input.lastName) userInput.lastName = input.lastName;
    const created = await createBasiqUser(userInput);
    providerUserId = created.id;
    logSafeMobileDiag('basiq.user.created', {
      providerUserId,
      mobileEnding: mobileEndingDigits(mobileForApi),
      mobileMasked,
      sandbox,
    });
  } else {
    // Inspect retained Basiq user mobile (masked only) and replace if stale/placeholder.
    try {
      const remote = await getBasiqUser(providerUserId);
      const remoteEnding = mobileEndingDigits(remote.mobile);
      const remotePlaceholder = isBasiqPlaceholderMobile(remote.mobile);
      logSafeMobileDiag('basiq.user.inspected', {
        providerUserId,
        remoteMobileEnding: remoteEnding,
        remoteIsPlaceholder: remotePlaceholder,
        willOverrideWithEnding: mobileEndingDigits(mobileForApi),
        sandbox,
      });
    } catch (error) {
      logSafeMobileDiag('basiq.user.inspect_failed', {
        providerUserId,
        category: error instanceof BasiqClientError ? error.category : 'provider_error',
      });
    }
    await updateBasiqUser(providerUserId, { mobile: mobileForApi });
    logSafeMobileDiag('basiq.user.mobile_updated', {
      providerUserId,
      mobileEnding: mobileEndingDigits(mobileForApi),
      mobileMasked,
      sandbox,
    });
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
    authLinkMobile: mobileForApi,
  };
  if (existing && existing.status !== 'disconnected') {
    upsertInput.id = existing.id;
  }
  const connection = await store.upsertConnection(upsertInput);

  // New AuthLink invalidates prior links; mobile overrides User mobile for 2FA SMS.
  const authLink = await createBasiqAuthLink(providerUserId, { mobile: mobileForApi });
  const authLinkMobile =
    normalizeAustralianMobileE164(authLink.mobile) || mobileForApi;
  const authLinkMobileMasked =
    maskAustralianMobileE164(authLinkMobile) || mobileMasked;

  logSafeMobileDiag('basiq.auth_link.created', {
    providerUserId,
    mobileEnding: mobileEndingDigits(authLinkMobile),
    mobileMasked: authLinkMobileMasked,
    sandbox,
    expiresAt: authLink.expiresAt,
  });

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

  // Persist confirmed mobile on the connection for reconnect/resend.
  await store.updateConnectionFields(input.businessId, connection.id, {
    authLinkMobile: authLinkMobile,
  });

  return {
    authLinkUrl: authLink.publicUrl,
    stateToken,
    connection,
    expiresAt: authLink.expiresAt,
    environment: sandbox ? 'sandbox' : 'production',
    deliveryMode: 'open_auth_link',
    sandbox,
    authLinkMobile,
    authLinkMobileMasked,
    message: sandbox
      ? `Sandbox AuthLink created. SMS verification code will be sent to ${authLinkMobileMasked}. Opening Basiq Connect for a sandbox test institution.`
      : `AuthLink created. SMS verification code will be sent to ${authLinkMobileMasked}. Opening Basiq Connect.`,
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
    authLinkMobile: null,
  });
  if (!updated) throw new Error('BANK_CONNECTION_NOT_FOUND');
  return updated;
}
