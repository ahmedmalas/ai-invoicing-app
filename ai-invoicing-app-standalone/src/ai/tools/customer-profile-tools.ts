import { z } from 'zod';

import type { AleyaActionRegistry } from '../registry.js';

export function registerCustomerProfileTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'search_customers',
    description: 'Find customers by name, email, phone, or ABN fragment.',
    category: 'customers',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async execute(input, ctx) {
      const customers = await ctx.db.listCustomers({ limit: 500, offset: 0 });
      const q = input.query.trim().toLowerCase();
      const matched = customers
        .filter((item) => {
          const hay = `${item.displayName} ${item.email || ''} ${item.phone || ''} ${item.abnTaxId || ''} ${item.address || ''}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, input.limit);
      return {
        ok: true,
        data: { customers: matched, count: matched.length },
        summary: `Found ${matched.length} customer(s) matching "${input.query}".`,
        ui: { refresh: ['customers'] },
      };
    },
  });

  registry.register({
    name: 'get_customer',
    description: 'Load a customer record by id.',
    category: 'customers',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({ customerId: z.string().uuid() }),
    async execute(input, ctx) {
      const customer = await ctx.db.getCustomerById(input.customerId);
      if (!customer) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found.' };
      return {
        ok: true,
        data: { customer },
        summary: `Loaded customer ${customer.displayName}.`,
        ui: { focusCustomerId: customer.id },
      };
    },
  });

  registry.register({
    name: 'create_customer',
    description:
      'Create a customer when display name and any provided contact details are clear. No confirmation required.',
    category: 'customers',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      displayName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      abnTaxId: z.string().optional(),
      notes: z.string().optional(),
    }),
    async execute(input, ctx) {
      const customer = await ctx.db.createCustomer(input);
      return {
        ok: true,
        data: { customer },
        summary: `Created customer ${customer.displayName}.`,
        ui: { refresh: ['customers'], focusCustomerId: customer.id },
      };
    },
  });

  registry.register({
    name: 'update_customer',
    description: 'Update an existing customer record.',
    category: 'customers',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'snapshot',
    inputSchema: z.object({
      customerId: z.string().uuid(),
      displayName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      abnTaxId: z.string().optional(),
      notes: z.string().optional(),
    }),
    async execute(input, ctx) {
      const existing = await ctx.db.getCustomerById(input.customerId);
      if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found.' };
      const { customerId, ...body } = input;
      const customer = await ctx.db.updateCustomer(customerId, body);
      return {
        ok: true,
        data: { customer },
        summary: `Updated customer ${customer.displayName}.`,
        ui: { refresh: ['customers'], focusCustomerId: customer.id },
      };
    },
  });

  registry.register({
    name: 'delete_customer',
    description: 'Delete a customer when safe. Requires confirmation.',
    category: 'customers',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({ customerId: z.string().uuid() }),
    async execute(input, ctx) {
      await ctx.db.deleteCustomer(input.customerId);
      return {
        ok: true,
        data: { customerId: input.customerId },
        summary: 'Deleted customer.',
        ui: { refresh: ['customers'] },
      };
    },
  });

  registry.register({
    name: 'get_business_profile',
    description:
      'Read business contact/branding details (company name, ABN, address, email, phone, colours). ONLY when the user asks about the business profile, branding, or contact details. NEVER use for bank-feed connectivity, sync status, imported bank transactions, or connection health — those are not in the business profile. Prefer get_bank_feed_status for bank-feed questions.',
    category: 'profile',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    domain: 'profile',
    intents: ['business_contact', 'branding'],
    sensitivity: 'high',
    latencyClass: 'fast',
    mutates: false,
    conclusiveFor: ['business_contact', 'branding'],
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const profile = await ctx.db.getBusinessProfile();
      return {
        ok: true,
        data: { profile },
        summary: profile ? `Loaded profile for ${profile.companyName}.` : 'No business profile saved yet.',
        ui: { refresh: ['profile'] },
      };
    },
  });

  registry.register({
    name: 'update_business_profile',
    description:
      'Update business profile fields. Overwriting important profile data requires confirmation.',
    category: 'profile',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({
      companyName: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      abnTaxId: z.string().optional(),
      bankAccountName: z.string().optional(),
      bankBsb: z.string().optional(),
      bankAccountNumber: z.string().optional(),
      paymentTermsDefault: z.string().optional(),
    }),
    async execute(input, ctx) {
      const existing = (await ctx.db.getBusinessProfile()) || {
        companyName: '',
        email: null,
        phone: null,
        address: null,
        abnTaxId: null,
      };
      const next = {
        ...existing,
        ...Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        ),
      };
      const profile = await ctx.db.upsertBusinessProfile(next as never);
      return {
        ok: true,
        data: { profile },
        summary: 'Updated business profile.',
        ui: { refresh: ['profile'] },
      };
    },
  });
}
