import { BASIQ_CONNECTIONS_NOT_ENABLED_CODE } from './basiq-errors.js';
import type { BankConnection, BankConnectionStatus } from './types.js';

const CONSENT_EXPIRING_MS = 7 * 24 * 60 * 60 * 1000;
const DELAYED_SYNC_MS = 36 * 60 * 60 * 1000;

/** Map provider/raw status strings into Aleya connection statuses. */
export function mapProviderConnectionStatus(raw: string | null | undefined): BankConnectionStatus {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value) return 'connecting';
  if (value.includes('active') || value === 'connected') return 'connected';
  if (value.includes('pending') || value.includes('in-progress') || value === 'pre-init') {
    return 'connecting';
  }
  if (value.includes('invalid') || value.includes('reauth') || value.includes('login')) {
    return 'reauth_required';
  }
  if (value.includes('revok') || value.includes('deleted') || value.includes('disconnect')) {
    return 'disconnected';
  }
  if (value.includes('fail') || value.includes('error')) return 'error';
  return 'connecting';
}

/** Derive display status from stored connection + clocks. */
export function deriveBankConnectionStatus(
  connection: BankConnection | null,
  options?: { now?: Date; providerUnavailable?: boolean },
): BankConnectionStatus {
  if (!connection) return 'not_connected';
  if (options?.providerUnavailable) return 'provider_unavailable';
  if (connection.status === 'disconnected') return 'disconnected';
  if (connection.status === 'syncing') return 'syncing';
  if (connection.status === 'connecting') return 'connecting';
  if (connection.status === 'reauth_required') return 'reauth_required';
  if (connection.status === 'error') return 'error';
  if (connection.status === 'provider_unavailable') return 'provider_unavailable';

  const now = options?.now ?? new Date();
  if (connection.consentExpiresAt) {
    const expires = Date.parse(connection.consentExpiresAt);
    if (Number.isFinite(expires)) {
      if (expires <= now.getTime()) return 'reauth_required';
      if (expires - now.getTime() <= CONSENT_EXPIRING_MS) return 'consent_expiring';
    }
  }

  if (connection.status === 'connected' || connection.status === 'connected_delayed') {
    const lastOk = connection.lastSuccessfulSyncAt
      ? Date.parse(connection.lastSuccessfulSyncAt)
      : NaN;
    if (Number.isFinite(lastOk) && now.getTime() - lastOk > DELAYED_SYNC_MS) {
      return 'connected_delayed';
    }
    return 'connected';
  }

  return connection.status;
}

export function nextActionForStatus(
  status: BankConnectionStatus,
  options?: { errorCode?: string | null },
): string {
  if (options?.errorCode === BASIQ_CONNECTIONS_NOT_ENABLED_CODE) {
    return 'In the Basiq Dashboard for this same application/API key: enable Connections/Data, enable sandbox connections, and set Hooli OB (AU00000) method to open-banking. If those controls are unavailable, contact Basiq Support with this error. Do not create another API key unless Basiq confirms the current application cannot be enabled. Then reconnect.';
  }
  switch (status) {
    case 'not_connected':
      return 'Open Settings → Bank Feeds, confirm your Australian mobile for AuthLink SMS verification, then connect via Basiq AuthLink.';
    case 'connecting':
      return 'Enter the SMS code on Basiq AuthLink (sent to the masked mobile shown in Aleya), finish consent, then return. Use Change mobile or Resend AuthLink if needed.';
    case 'syncing':
      return 'Wait for the current sync to finish, or refresh shortly.';
    case 'connected':
      return 'No action required. Use Refresh to pull the latest transactions.';
    case 'connected_delayed':
      return 'Refresh the bank feed — the last successful sync is older than expected.';
    case 'consent_expiring':
      return 'Reconnect soon so open-banking consent does not expire.';
    case 'reauth_required':
      return 'Reconnect the bank feed to renew consent or credentials.';
    case 'provider_unavailable':
      return 'Try again later. Basiq appears unavailable.';
    case 'disconnected':
      return 'Connect a bank account again when ready.';
    case 'error':
      return 'Review the connection error, then Refresh or Reconnect.';
    default:
      return 'Open Banking to review connection status.';
  }
}

export function maskAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\s+/g, '');
  if (digits.length <= 4) return `••••${digits}`;
  return `••••${digits.slice(-4)}`;
}
