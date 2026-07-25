import { z } from 'zod';

import { PRODUCT_CAPABILITIES } from '../product-capabilities.js';
import type { AleyaActionRegistry } from '../registry.js';

export function registerCapabilityTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'list_product_capabilities',
    description:
      'List what exists in the Aleya product versus what Aleya AI can currently read or change. Use for “what can you control?”, capability audits, or whether a feature exists. Prefer this over guessing or calling unrelated profile tools.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'meta',
    intents: ['list_controllable', 'feature_exists', 'capability_audit'],
    sensitivity: 'low',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['list_controllable', 'feature_exists'],
    inputSchema: z.object({
      domain: z.string().optional().describe('Optional domain filter, e.g. banking, invoices.'),
    }),
    async execute(input) {
      const rows = PRODUCT_CAPABILITIES.filter((item) =>
        input.domain ? item.domain === input.domain || item.id === input.domain : true,
      ).map((item) => ({
        id: item.id,
        domain: item.domain,
        label: item.label,
        appExists: item.appExists,
        aiAccess: item.aiAccess,
        tools: item.tools,
        confirmation: item.confirmation,
        undo: item.undo,
        permissions: item.permissions,
        limitation: item.limitation,
        priority: item.priority,
      }));
      return {
        ok: true,
        data: { capabilities: rows, count: rows.length },
        summary: `Listed ${rows.length} product capability row(s).`,
      };
    },
  });

  registry.register({
    name: 'get_feature_status',
    description:
      'Look up whether a named product feature exists and whether Aleya AI can access it. Distinguishes feature-absent vs tool-absent vs permission vs provider issues. Use before offering navigation to a screen.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'meta',
    intents: ['feature_exists', 'feature_absent'],
    sensitivity: 'low',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['feature_exists', 'feature_absent'],
    inputSchema: z.object({
      feature: z
        .string()
        .min(1)
        .describe('Feature id or label fragment, e.g. bank_feeds, quotes, notifications.'),
    }),
    async execute(input) {
      const needle = input.feature.trim().toLowerCase();
      const match =
        PRODUCT_CAPABILITIES.find((item) => item.id === needle) ||
        PRODUCT_CAPABILITIES.find(
          (item) =>
            item.label.toLowerCase().includes(needle) ||
            item.domain.toLowerCase() === needle ||
            item.conclusiveIntents.some((intent) => intent.includes(needle.replace(/\s+/g, '_'))),
        );
      if (!match) {
        return {
          ok: true,
          data: {
            found: false,
            feature: input.feature,
            appExists: 'no',
            aiAccess: 'none',
            distinction: {
              featureAbsent: true,
              toolAbsentForExistingFeature: false,
              permissionDenied: false,
              providerDisconnected: false,
              temporaryFailure: false,
            },
            message: `No matching Aleya feature named “${input.feature}” is implemented.`,
          },
          summary: `Feature “${input.feature}” not found in the product capability map.`,
        };
      }
      const toolAbsentForExistingFeature =
        match.appExists !== 'no' && match.aiAccess === 'none';
      return {
        ok: true,
        data: {
          found: true,
          ...match,
          distinction: {
            featureAbsent: match.appExists === 'no',
            toolAbsentForExistingFeature,
            permissionDenied: false,
            providerDisconnected: false,
            temporaryFailure: false,
          },
        },
        summary:
          match.appExists === 'no'
            ? `${match.label} is not implemented in this Aleya workspace.`
            : toolAbsentForExistingFeature
              ? `${match.label} exists in the app, but Aleya AI does not yet have tools to access it.`
              : `${match.label}: app=${match.appExists}, ai=${match.aiAccess}.`,
      };
    },
  });

  registry.register({
    name: 'list_unpaid_invoices',
    description:
      'List finalised invoices that still have outstanding balance (unpaid / part-paid / awaiting payment). Use for “which invoices are still unpaid?”. Do not use get_business_profile.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'invoices',
    intents: ['unpaid_invoices'],
    sensitivity: 'medium',
    latencyClass: 'standard',
    mutates: false,
    conclusiveFor: ['unpaid_invoices'],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(25),
      customerId: z
        .string()
        .uuid()
        .optional()
        .describe('Omit when not filtering by customer. Do not pass a nil UUID.'),
    }),
    async execute(input, ctx) {
      const customerId =
        input.customerId && input.customerId !== '00000000-0000-0000-0000-000000000000'
          ? input.customerId
          : undefined;
      const report = await ctx.db.getReportingReadModel({ limit: 500 });
      const ar = report?.accountsReceivable?.invoices || [];
      let unpaidRows = ar.filter((row) => Number(row.outstanding || 0) > 0.0001);
      if (customerId) {
        unpaidRows = unpaidRows.filter((row) => row.customerId === customerId);
      }
      unpaidRows = unpaidRows
        .sort((a, b) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')))
        .slice(0, input.limit);

      const customers = await ctx.db.listCustomers({ limit: 500, offset: 0 });
      const nameById = new Map(
        (customers || []).map((customer) => [
          customer.id,
          customer.displayName || customer.id,
        ]),
      );

      const unpaid = unpaidRows.map((row) => ({
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        customerId: row.customerId,
        customerName: nameById.get(row.customerId) || null,
        issueDate: row.issueDate,
        totalInvoiced: row.totalInvoiced,
        totalPaid: row.totalPaid,
        outstanding: row.outstanding,
      }));
      return {
        ok: true,
        data: { invoices: unpaid, count: unpaid.length },
        summary:
          unpaid.length === 0
            ? 'No unpaid invoices found.'
            : `Found ${unpaid.length} unpaid invoice(s).`,
        ui: { refresh: ['invoices'] },
      };
    },
  });
}
