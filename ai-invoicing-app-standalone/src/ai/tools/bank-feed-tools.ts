import { z } from 'zod';

import type { AleyaActionRegistry } from '../registry.js';
import {
  BANK_FEEDS_RETIRED_CODE,
  BANK_FEEDS_RETIRED_MESSAGE,
  retiredBankFeedStatus,
} from '../../domain/banking/retired.js';

function retiredToolResult() {
  return {
    ok: false as const,
    code: BANK_FEEDS_RETIRED_CODE,
    message: BANK_FEEDS_RETIRED_MESSAGE,
    data: { status: retiredBankFeedStatus() },
    summary: BANK_FEEDS_RETIRED_MESSAGE,
  };
}

/** Bank-feed tools after Basiq retirement — status only; connect/sync unavailable. */
export function registerBankFeedTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'get_bank_feed_status',
    description:
      'Report whether bank feeds are connected. Currently returns not connected — previous provider retired.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_connected', 'bank_feed_sync', 'bank_feed_errors', 'bank_accounts'],
    sensitivity: 'low',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['bank_feed_connected', 'bank_feed_sync', 'bank_feed_errors', 'bank_accounts'],
    inputSchema: z.object({
      question: z.string().optional(),
    }),
    async execute() {
      const status = retiredBankFeedStatus();
      return {
        ok: true,
        data: status,
        summary: BANK_FEEDS_RETIRED_MESSAGE,
      };
    },
  });

  const readOnly = [
    'list_connected_bank_accounts',
    'get_bank_account_connection',
    'get_last_bank_sync',
    'list_bank_feed_errors',
    'list_recent_bank_transactions',
    'search_bank_transactions',
  ] as const;

  for (const name of readOnly) {
    registry.register({
      name,
      description: `${name.replaceAll('_', ' ')} — unavailable while bank feeds are unconfigured.`,
      category: 'meta',
      milestone: 'M1',
      confirmation: 'none',
      undo: 'none',
      domain: 'banking',
      intents: ['bank_transactions', 'bank_accounts', 'bank_feed_errors'],
      sensitivity: 'low',
      latencyClass: 'fast',
      mutates: false,
      conclusiveFor: [],
      inputSchema: z.object({}).passthrough(),
      async execute() {
        return retiredToolResult();
      },
    });
  }

  for (const name of ['refresh_bank_feed', 'disconnect_bank_feed', 'reconnect_bank_feed'] as const) {
    registry.register({
      name,
      description: `${name.replaceAll('_', ' ')} — unavailable; new bank-feed provider is being configured.`,
      category: 'meta',
      milestone: 'M1',
      confirmation:
        name === 'disconnect_bank_feed' || name === 'reconnect_bank_feed' ? 'required' : 'none',
      undo: 'none',
      domain: 'banking',
      intents: ['bank_feed_connected', 'bank_feed_sync'],
      sensitivity: 'medium',
      latencyClass: 'fast',
      mutates: true,
      conclusiveFor: [],
      inputSchema: z.object({}).passthrough(),
      async execute() {
        return retiredToolResult();
      },
    });
  }
}
