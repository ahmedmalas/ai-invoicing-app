import { describe, expect, it, beforeEach } from 'vitest';

import {
  answerForStatusIntent,
  bankFeedStatusPayload,
  matchStatusIntent,
  PRODUCT_CAPABILITIES,
} from '../../src/ai/product-capabilities.js';
import { resetAleyaRegistryForTests, getAleyaRegistry } from '../../src/ai/registry.js';
import { ensureAleyaToolsRegistered } from '../../src/ai/tools/register-all.js';

describe('Aleya product capability map', () => {
  it('marks bank feeds as not implemented (not a live connection)', () => {
    const bank = PRODUCT_CAPABILITIES.find((item) => item.id === 'bank_feeds');
    expect(bank?.appExists).toBe('no');
    const status = bankFeedStatusPayload();
    expect(status.implemented).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.distinction.featureAbsent).toBe(true);
    expect(status.warning.toLowerCase()).toContain('not yet been implemented');
  });

  it('routes bank-feed questions to status intents', () => {
    expect(matchStatusIntent('Okay, is my bankfeed connected to my account?')).toBe(
      'bank_feed_connected',
    );
    expect(matchStatusIntent('When did it last sync?')).toBe('bank_feed_sync');
    expect(matchStatusIntent('When did my bank feed last sync?')).toBe('bank_feed_sync');
    expect(matchStatusIntent('Are there any bank-feed errors?')).toBe('bank_feed_errors');
    expect(matchStatusIntent('Show me the latest five imported bank transactions.')).toBe(
      'bank_transactions',
    );
    expect(matchStatusIntent('What parts of Aleya can you currently control?')).toBe(
      'list_controllable',
    );
  });

  it('answers bank-feed questions without implying a UI page exists', () => {
    const answer = answerForStatusIntent('bank_feed_connected');
    expect(answer.assistantMessage).toContain('not currently implemented');
    expect(answer.assistantMessage.toLowerCase()).not.toContain('open settings');
    expect(answer.toolName).toBe('get_bank_feed_status');
  });
});

describe('Aleya capability tools', () => {
  beforeEach(() => {
    resetAleyaRegistryForTests();
  });

  it('registers bank-feed and product capability tools', async () => {
    const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
    for (const name of [
      'get_bank_feed_status',
      'list_product_capabilities',
      'get_feature_status',
      'list_unpaid_invoices',
    ]) {
      expect(registry.names()).toContain(name);
    }
    const result = await registry.execute('get_bank_feed_status', {}, {
      db: {} as never,
      userId: 'test',
      organizationId: 'org',
      conversationId: 'conv',
      visibleState: {},
      approvedTokens: new Set(),
      requestConfirmation: () => {
        throw new Error('not expected');
      },
      pushUndo: async () => 'x',
      undoLast: async () => ({ ok: false, code: 'x', message: 'x' }),
      logAudit: async () => undefined,
      now: () => new Date(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { implemented: boolean }).implemented).toBe(false);
    }
  });
});
