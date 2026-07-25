import { z } from 'zod';

import type { AleyaActionRegistry } from '../registry.js';
import { undoLastAction } from '../tool-context.js';

export function registerPaymentsMetaTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'record_payment',
    description:
      'Record a customer payment and allocate it to one or more invoices. Requires confirmation.',
    category: 'payments',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({
      customerId: z.string().uuid(),
      paymentDate: z.string().min(1),
      paymentMethod: z.string().min(1),
      reference: z.string().min(1),
      amount: z.number().positive(),
      notes: z.string().optional(),
      allocations: z
        .array(
          z.object({
            invoiceId: z.string().uuid(),
            amount: z.number().positive(),
          }),
        )
        .min(1),
    }),
    async execute(input, ctx) {
      const payment = await ctx.db.createCustomerPayment({
        customerId: input.customerId,
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        reference: input.reference,
        amount: input.amount,
        notes: input.notes,
        allocations: input.allocations,
      });
      return {
        ok: true,
        data: { payment },
        summary: `Recorded payment of $${input.amount.toFixed(2)}.`,
        ui: { refresh: ['payments', 'invoices'] },
      };
    },
  });

  registry.register({
    name: 'list_payments',
    description: 'List payments, optionally filtered by customer or invoice.',
    category: 'payments',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      customerId: z.string().uuid().optional(),
      invoiceId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async execute(input, ctx) {
      const filter: { customerId?: string; invoiceId?: string } = {};
      // Models often fill optional UUIDs with the nil placeholder — treat as omitted.
      const customerId =
        input.customerId && input.customerId !== '00000000-0000-0000-0000-000000000000'
          ? input.customerId
          : undefined;
      const invoiceId =
        input.invoiceId && input.invoiceId !== '00000000-0000-0000-0000-000000000000'
          ? input.invoiceId
          : undefined;
      if (customerId) filter.customerId = customerId;
      if (invoiceId) filter.invoiceId = invoiceId;
      const payments = await ctx.db.listCustomerPayments(filter, {
        limit: input.limit,
        offset: 0,
      });
      return {
        ok: true,
        data: { payments, count: payments.length },
        summary: `Found ${payments.length} payment(s).`,
        ui: { refresh: ['payments'] },
      };
    },
  });

  registry.register({
    name: 'universal_search',
    description: 'Search across customers, invoices, quotes, and payments using the app search index.',
    category: 'search',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    async execute(input, ctx) {
      if (typeof (ctx.db as { search?: Function }).search === 'function') {
        const results = await (ctx.db as { search: (q: string) => Promise<unknown> }).search(
          input.query,
        );
        return {
          ok: true,
          data: { results },
          summary: `Search completed for "${input.query}".`,
          ui: { refresh: ['search'] },
        };
      }
      const [customers, invoices] = await Promise.all([
        ctx.db.listCustomers({ limit: 200, offset: 0 }),
        ctx.db.listInvoices({}, { limit: 200, offset: 0 }),
      ]);
      const q = input.query.toLowerCase();
      const matchedCustomers = customers.filter((item) =>
        `${item.displayName} ${item.email || ''}`.toLowerCase().includes(q),
      );
      const matchedInvoices = invoices.filter((item) =>
        `${item.title} ${item.invoiceNumber || ''}`.toLowerCase().includes(q),
      );
      return {
        ok: true,
        data: { customers: matchedCustomers, invoices: matchedInvoices },
        summary: `Found ${matchedCustomers.length} customer(s) and ${matchedInvoices.length} invoice(s).`,
        ui: { refresh: ['search'] },
      };
    },
  });

  registry.register({
    name: 'diagnose_invoice_issues',
    description:
      'Inspect an invoice for missing customer, empty lines, GST inconsistencies, and profile readiness issues.',
    category: 'diagnostics',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({ invoiceId: z.string().uuid() }),
    async execute(input, ctx) {
      const invoice = await ctx.db.getInvoiceById(input.invoiceId);
      if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      const customer = await ctx.db.getCustomerById(invoice.customerId);
      const profile = await ctx.db.getBusinessProfile();
      const issues: string[] = [];
      if (!customer) issues.push('Customer record missing.');
      if (!invoice.lineItems.length) issues.push('No line items.');
      if (!invoice.title?.trim()) issues.push('Title missing.');
      if (!profile?.companyName) issues.push('Business profile company name missing.');
      const labourWithoutGst = invoice.lineItems.filter(
        (item) => /labour/i.test(item.description) && !item.gstApplicable,
      );
      if (labourWithoutGst.length) {
        issues.push(`${labourWithoutGst.length} labour line(s) without GST.`);
      }
      return {
        ok: true,
        data: { invoiceId: invoice.id, issues, readyToFinalise: issues.length === 0 && invoice.status === 'Draft' },
        summary: issues.length ? `Found ${issues.length} issue(s).` : 'No issues detected.',
      };
    },
  });

  registry.register({
    name: 'list_registered_tools',
    description:
      'List every registered Aleya AI tool with category, confirmation, and undo metadata. Use this to discover capabilities dynamically.',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      category: z
        .enum([
          'invoices',
          'customers',
          'templates',
          'profile',
          'payments',
          'search',
          'pdf',
          'email',
          'bulk',
          'diagnostics',
          'meta',
          'undo',
        ])
        .optional(),
    }),
    async execute(input) {
      const { getAleyaRegistry } = await import('../registry.js');
      const rows = getAleyaRegistry()
        .list(input.category ? { category: input.category } : undefined)
        .map((item) => ({
          name: item.name,
          category: item.category,
          confirmation: item.confirmation,
          undo: item.undo,
          milestone: item.milestone,
          description: item.description,
        }));
      return {
        ok: true,
        data: { tools: rows, count: rows.length },
        summary: `${rows.length} registered tool(s).`,
      };
    },
  });

  registry.register({
    name: 'undo_last_ai_edit',
    description: 'Undo the most recent reversible Aleya AI edit in this conversation.',
    category: 'undo',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      return undoLastAction(ctx.db, ctx.conversationId);
    },
  });

  registry.register({
    name: 'get_visible_app_state',
    description: 'Read the UI-visible state passed from the client (active invoice/customer/path).',
    category: 'meta',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      return {
        ok: true,
        data: { visibleState: ctx.visibleState },
        summary: 'Loaded visible application state.',
      };
    },
  });
}
