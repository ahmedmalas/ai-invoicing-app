import { z } from 'zod';

import { getWorkspaceContext } from '../../auth/workspace-context.js';
import { isBasiqSandboxEnvironment } from '../../services/basiq-client.js';
import type { AleyaActionRegistry } from '../registry.js';

function businessId(ctx: { organizationId: string }): string {
  return getWorkspaceContext()?.workspaceId || ctx.organizationId;
}

function formatMoneyInOut(direction: string, amount: number): string {
  const abs = Math.abs(Number(amount) || 0).toFixed(2);
  if (direction === 'credit') return `Money in $${abs}`;
  if (direction === 'debit') return `Money out $${abs}`;
  return `$${abs}`;
}

export function registerBankFeedTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'get_bank_feed_status',
    description:
      'Answer whether the bank feed is connected, with institution, masked account, status, last successful sync, errors, and next action. Use for “Is my bank feed connected?”. Do NOT call get_business_profile.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_connected', 'bank_feed_sync', 'bank_feed_errors', 'bank_accounts'],
    sensitivity: 'medium',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['bank_feed_connected', 'bank_feed_sync', 'bank_feed_errors', 'bank_accounts'],
    inputSchema: z.object({
      question: z.string().optional(),
    }),
    async execute(_input, ctx) {
      const status = await ctx.db.getBankFeedStatus(businessId(ctx));
      const connectedLabel = status.connected ? 'Connected' : 'Not connected';
      const summary = [
        `Bank feed: ${connectedLabel}.`,
        status.institution ? `Institution: ${status.institution}.` : null,
        status.maskedAccount ? `Account: ${status.maskedAccount}.` : null,
        `Status: ${status.status}.`,
        status.lastSuccessfulSyncAt
          ? `Last successful sync: ${status.lastSuccessfulSyncAt}.`
          : 'Last successful sync: none.',
        status.errors.length ? `Current error: ${status.errors[0]}.` : 'No current error.',
        status.nextAction ? `Next action: ${status.nextAction}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      return { ok: true, data: status, summary };
    },
  });

  registry.register({
    name: 'list_connected_bank_accounts',
    description: 'List connected bank accounts with masked account numbers only.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_accounts'],
    sensitivity: 'medium',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['bank_accounts'],
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const accounts = await ctx.db.listBankAccounts(businessId(ctx), true);
      return {
        ok: true,
        data: {
          accounts: accounts.map((account) => ({
            id: account.id,
            institutionName: account.institutionName,
            accountName: account.accountName,
            maskedAccountNumber: account.maskedAccountNumber,
            accountType: account.accountType,
            currency: account.currency,
          })),
          count: accounts.length,
        },
        summary:
          accounts.length === 0
            ? 'No connected bank accounts.'
            : `Found ${accounts.length} connected bank account(s).`,
      };
    },
  });

  registry.register({
    name: 'get_bank_account_connection',
    description: 'Get the current bank connection record and derived status for this business.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_connected'],
    sensitivity: 'medium',
    latencyClass: 'fast',
    mutates: false,
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const connection = await ctx.db.getBankConnection(businessId(ctx));
      const status = await ctx.db.getBankFeedStatus(businessId(ctx));
      return {
        ok: true,
        data: {
          connection: connection
            ? {
                id: connection.id,
                provider: connection.provider,
                status: status.status,
                consentExpiresAt: connection.consentExpiresAt,
                lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
                lastSyncAttemptAt: connection.lastSyncAttemptAt,
                errorCode: connection.errorCode,
                errorMessage: connection.errorMessage,
              }
            : null,
        },
        summary: connection
          ? `Connection status: ${status.status}.`
          : 'No bank connection for this business.',
      };
    },
  });

  registry.register({
    name: 'get_last_bank_sync',
    description:
      'Return the stored last successful and last attempted bank sync timestamps. Use for “When did it last sync?”.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_sync'],
    sensitivity: 'low',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['bank_feed_sync'],
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const connection = await ctx.db.getBankConnection(businessId(ctx));
      return {
        ok: true,
        data: {
          lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt ?? null,
          lastSyncAttemptAt: connection?.lastSyncAttemptAt ?? null,
          status: connection?.status ?? 'not_connected',
        },
        summary: connection?.lastSuccessfulSyncAt
          ? `Last successful bank sync: ${connection.lastSuccessfulSyncAt}.`
          : 'There is no successful bank sync recorded yet.',
      };
    },
  });

  registry.register({
    name: 'list_bank_feed_errors',
    description: 'List current bank-feed connection/sync errors for this business.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_errors'],
    sensitivity: 'medium',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['bank_feed_errors'],
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const status = await ctx.db.getBankFeedStatus(businessId(ctx));
      return {
        ok: true,
        data: {
          errors: status.errors,
          status: status.status,
          warning: status.warning,
        },
        summary:
          status.errors.length === 0
            ? 'No bank-feed errors recorded.'
            : `Bank-feed errors: ${status.errors.join('; ')}`,
      };
    },
  });

  registry.register({
    name: 'refresh_bank_feed',
    description: 'Trigger a manual bank-feed refresh and import latest accounts/transactions.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_sync'],
    sensitivity: 'medium',
    latencyClass: 'slow',
    mutates: true,
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const result = await ctx.db.refreshBankFeed(businessId(ctx));
      return {
        ok: true,
        data: result,
        summary: `Refreshed bank feed. Imported ${result.transactionsUpserted} new transaction(s); ${result.transactionsSkippedDuplicate} duplicate(s) skipped.`,
        ui: { refresh: ['banking'] },
      };
    },
  });

  registry.register({
    name: 'list_recent_bank_transactions',
    description:
      'List the most recent imported bank transactions for the authenticated business. Use for “Show me the latest five bank transactions.” Returns only the requested rows — never full history.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_transactions'],
    sensitivity: 'high',
    latencyClass: 'standard',
    mutates: false,
    conclusiveFor: ['bank_transactions'],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(25).default(5),
      accountId: z.string().uuid().optional(),
    }),
    async execute(input, ctx) {
      const filter: {
        businessId: string;
        limit: number;
        offset: number;
        accountId?: string;
      } = {
        businessId: businessId(ctx),
        limit: input.limit,
        offset: 0,
      };
      if (input.accountId) filter.accountId = input.accountId;
      const result = await ctx.db.listBankTransactions(filter);
      const rows = result.items.map((tx) => ({
        id: tx.id,
        date: tx.transactionDate,
        description: tx.description,
        money: formatMoneyInOut(tx.direction, tx.amount),
        direction: tx.direction,
        amount: tx.amount,
        merchantName: tx.merchantName,
      }));
      return {
        ok: true,
        data: { transactions: rows, count: rows.length },
        summary:
          rows.length === 0
            ? 'No imported bank transactions yet.'
            : `Latest ${rows.length} bank transaction(s): ${rows
                .map((row) => `${row.date} ${row.description || '—'} (${row.money})`)
                .join('; ')}.`,
      };
    },
  });

  registry.register({
    name: 'search_bank_transactions',
    description: 'Search imported bank transactions by description/merchant/reference (paginated).',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_transactions'],
    sensitivity: 'high',
    latencyClass: 'standard',
    mutates: false,
    inputSchema: z.object({
      search: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
      accountId: z.string().uuid().optional(),
    }),
    async execute(input, ctx) {
      const filter: {
        businessId: string;
        search: string;
        limit: number;
        offset: number;
        accountId?: string;
      } = {
        businessId: businessId(ctx),
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      };
      if (input.accountId) filter.accountId = input.accountId;
      const result = await ctx.db.listBankTransactions(filter);
      return {
        ok: true,
        data: {
          transactions: result.items.map((tx) => ({
            id: tx.id,
            date: tx.transactionDate,
            description: tx.description,
            money: formatMoneyInOut(tx.direction, tx.amount),
            direction: tx.direction,
            amount: tx.amount,
          })),
          total: result.total,
        },
        summary: `Found ${result.total} matching bank transaction(s).`,
      };
    },
  });

  registry.register({
    name: 'disconnect_bank_feed',
    description: 'Disconnect the bank feed. Requires explicit confirmation.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_connected'],
    sensitivity: 'high',
    latencyClass: 'standard',
    mutates: true,
    inputSchema: z.object({
      confirm: z.literal(true).describe('Must be true after user confirms disconnect.'),
    }),
    async execute(input, ctx) {
      const connection = await ctx.db.disconnectBankFeed(businessId(ctx), input.confirm === true);
      return {
        ok: true,
        data: { connectionId: connection.id, status: connection.status },
        summary: 'Bank feed disconnected.',
        ui: { refresh: ['banking'] },
      };
    },
  });

  registry.register({
    name: 'reconnect_bank_feed',
    description:
      'Start a Basiq reconnect AuthLink. Requires confirmation because it may replace existing consent. Returns an AuthLink URL to open in the browser — Basiq does not SMS-deliver AuthLink URLs.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    domain: 'banking',
    intents: ['bank_feed_connected'],
    sensitivity: 'high',
    latencyClass: 'standard',
    mutates: true,
    inputSchema: z.object({
      confirm: z.literal(true),
      mobile: z
        .string()
        .min(8)
        .max(32)
        .optional()
        .describe(
          'Australian mobile (+614XXXXXXXX) for AuthLink 2FA in production only. Not used to SMS-deliver the AuthLink URL.',
        ),
    }),
    async execute(input, ctx) {
      const workspace = getWorkspaceContext();
      if (!workspace) {
        return {
          ok: false,
          code: 'AUTH_UNAUTHENTICATED',
          message: 'Cannot reconnect without workspace context.',
        };
      }
      const profile = await ctx.db.getBusinessProfile();
      const email =
        profile?.email?.trim() ||
        `${workspace.workspaceId.replaceAll('-', '').slice(0, 12)}@users.aleya.app`;
      const sandbox = isBasiqSandboxEnvironment();
      const mobile = input.mobile?.trim() || profile?.phone?.trim() || null;
      if (!sandbox && !mobile) {
        return {
          ok: false,
          code: 'BANK_CONNECT_MOBILE_REQUIRED',
          message:
            'Add a business phone number (+614XXXXXXXX) for AuthLink 2FA before reconnecting in production.',
        };
      }
      const started = await ctx.db.startBasiqBankConnect({
        businessId: businessId(ctx),
        workspaceId: workspace.workspaceId,
        workspaceSchema: workspace.schemaName,
        email,
        mobile,
        firstName: profile?.companyName?.split(/\s+/)[0] || 'Aleya',
        lastName: 'Business',
      });
      return {
        ok: true,
        data: {
          authLinkUrl: started.authLinkUrl,
          connectionId: started.connection.id,
          status: started.connection.status,
          environment: started.environment,
          sandbox: started.sandbox,
          deliveryMode: started.deliveryMode,
          message: started.message,
          warning: 'Completing reconnect may replace the existing open-banking consent.',
        },
        summary: started.message,
        ui: { refresh: ['banking'] },
      };
    },
  });
}
