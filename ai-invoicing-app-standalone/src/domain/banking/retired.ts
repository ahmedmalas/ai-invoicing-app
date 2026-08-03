import type { BankFeedStatusView } from './types.js';

export const BANK_FEEDS_RETIRED_CODE = 'BANK_FEEDS_PROVIDER_RETIRED';

export const BANK_FEEDS_RETIRED_MESSAGE =
  'Bank feeds are not connected yet. The previous provider has been retired and a new provider is being configured.';

/** Stable status payload for UI and AI after Basiq removal. */
export function retiredBankFeedStatus(): BankFeedStatusView {
  return {
    implemented: true,
    configured: false,
    connected: false,
    status: 'not_connected',
    provider: null,
    environment: null,
    sandbox: false,
    authLinkDelivery: null,
    authLinkMobileMasked: null,
    redirectUrlRequired: null,
    institution: null,
    maskedAccount: null,
    accounts: [],
    lastSuccessfulSyncAt: null,
    lastSyncAttemptAt: null,
    consentExpiresAt: null,
    errorCode: BANK_FEEDS_RETIRED_CODE,
    errors: [],
    warning: null,
    nextAction: BANK_FEEDS_RETIRED_MESSAGE,
    distinction: {
      featureAbsent: false,
      toolAbsentForExistingFeature: false,
      permissionDenied: false,
      providerDisconnected: true,
      temporaryFailure: false,
    },
    retired: true,
    code: BANK_FEEDS_RETIRED_CODE,
  };
}
