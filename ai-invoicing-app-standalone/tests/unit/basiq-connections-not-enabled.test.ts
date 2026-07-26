import { describe, expect, it } from 'vitest';

import {
  BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
  BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
  classifyBasiqHostedError,
  isBasiqConnectionsNotEnabledError,
} from '../../src/domain/banking/basiq-errors.js';
import { nextActionForStatus } from '../../src/domain/banking/status.js';

describe('Basiq Connections not enabled classification', () => {
  it('detects hosted Consent UI Connections not enabled + access-denied', () => {
    expect(
      isBasiqConnectionsNotEnabledError({
        title: 'Connections not enabled',
        code: 'access-denied',
        detail: 'Error: access-denied',
      }),
    ).toBe(true);
    expect(
      isBasiqConnectionsNotEnabledError({
        message: 'Please contact us to have your API key enabled for Connections.',
      }),
    ).toBe(true);
  });

  it('does not treat plain user-update access-denied as Connections product failure', () => {
    expect(
      isBasiqConnectionsNotEnabledError({
        title: 'Access denied.',
        code: 'access-denied',
        detail: 'Access denied. — access-denied',
      }),
    ).toBe(false);
  });

  it('does not blame mobile or API key /token auth', () => {
    const classified = classifyBasiqHostedError({
      title: 'Connections not enabled',
      error: 'access-denied',
      message: 'Connections not enabled',
    });
    expect(classified.connectionsNotEnabled).toBe(true);
    expect(classified.reason).toBe('connections_not_enabled');
    expect(classified.message).toBe(BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE);
    expect(classified.message.toLowerCase()).not.toContain('mobile');
    expect(classified.message.toLowerCase()).not.toContain('api key');
    expect(classified.message.toLowerCase()).not.toContain('/token');
  });

  it('surfaces a dashboard enablement next action for the stable error code', () => {
    const action = nextActionForStatus('error', {
      errorCode: BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
    });
    expect(action.toLowerCase()).toContain('basiq dashboard');
    expect(action.toLowerCase()).toContain('connections');
    expect(action.toLowerCase()).toContain('open-banking');
    expect(action.toLowerCase()).not.toContain('incorrect mobile');
  });
});
