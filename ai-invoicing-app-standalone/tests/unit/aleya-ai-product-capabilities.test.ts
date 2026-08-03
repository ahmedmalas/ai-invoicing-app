import { describe, expect, it, beforeEach } from 'vitest';

import {
  answerForStatusIntent,
  bankFeedStatusPayload,
  matchStatusIntent,
  PRODUCT_CAPABILITIES,
} from '../../src/ai/product-capabilities.js';
import { resetAleyaRegistryForTests, getAleyaRegistry } from '../../src/ai/registry.js';
import { ensureAleyaToolsRegistered } from '../../src/ai/tools/register-all.js';
import { createDatabase } from '../../src/db/database.js';
import { enterWorkspaceContext } from '../../src/auth/workspace-context.js';

describe('Aleya product capability map', () => {
  it('marks bank feeds as partial/unconfigured after Basiq retirement (not fully absent)', () => {
    const bank = PRODUCT_CAPABILITIES.find((item) => item.id === 'bank_feeds');
    expect(bank?.appExists).toBe('partial');
    expect(bank?.tools).toContain('get_bank_feed_status');
    expect(bank?.limitation?.toLowerCase()).toContain('retired');
    const status = bankFeedStatusPayload();
    expect(status.implemented).toBe(true);
    expect(status.distinction.featureAbsent).toBe(false);
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

  it('keeps list_controllable on the capability map fast path', () => {
    const answer = answerForStatusIntent('list_controllable');
    expect(answer.toolName).toBe('list_product_capabilities');
    expect(answer.assistantMessage.toLowerCase()).toContain('currently help');
  });
});

describe('Aleya bank-feed tools', () => {
  beforeEach(() => {
    resetAleyaRegistryForTests();
  });

  it('registers bank-feed tools that report the retired/not-connected state', async () => {
    const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
    for (const name of [
      'get_bank_feed_status',
      'list_connected_bank_accounts',
      'get_bank_account_connection',
      'get_last_bank_sync',
      'list_bank_feed_errors',
      'refresh_bank_feed',
      'list_recent_bank_transactions',
      'search_bank_transactions',
      'disconnect_bank_feed',
      'reconnect_bank_feed',
      'list_product_capabilities',
    ]) {
      expect(registry.names()).toContain(name);
    }

    const db = createDatabase(':memory:');
    const workspaceId = '00000000-0000-0000-0000-000000000001';
    enterWorkspaceContext({
      authUserId: '00000000-0000-0000-0000-000000000001',
      workspaceId,
      schemaName: 'public',
    });

    const result = await registry.execute(
      'get_bank_feed_status',
      {},
      {
        db,
        userId: '00000000-0000-0000-0000-000000000001',
        organizationId: workspaceId,
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
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { implemented: boolean }).implemented).toBe(true);
      expect((result.data as { connected: boolean }).connected).toBe(false);
    }
    db.close();
  });
});
