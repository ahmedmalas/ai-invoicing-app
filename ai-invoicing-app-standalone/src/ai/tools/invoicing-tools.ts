import { z } from 'zod';

import { calculateTotals } from '../../domain/invoices/gst.js';
import {
  getInvoiceTemplateBinding,
  listInvoiceTemplates,
  setInvoiceTemplateBinding,
} from '../../domain/templates/invoice-template-store.js';
import { generateInvoicePdfBuffer } from '../../services/pdf-service.js';
import type { AleyaActionRegistry } from '../registry.js';
import { pushInvoiceUndoSnapshot } from '../tool-context.js';

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean().default(true),
  productId: z.string().uuid().optional().nullable(),
});

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function registerInvoicingTools(registry: AleyaActionRegistry): void {
  registry.register({
    name: 'search_invoices',
    description:
      'Search and filter invoices by customer, status, payment state, title, invoice number, or template name. “Quantum Hire” means the Quantum Hire invoice layout template, not a customer. When finding a source invoice to duplicate, omit status so Finalised invoices are included; duplicate_invoice creates the new Draft.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      customerId: z.string().uuid().optional(),
      status: z.enum(['Draft', 'Finalised']).optional(),
      paymentState: z
        .enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled'])
        .optional(),
      query: z.string().optional(),
      templateQuery: z
        .string()
        .optional()
        .describe('Match invoices bound to a template whose name contains this text (e.g. Quantum Hire).'),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async execute(input, ctx) {
      const q = String(input.query || '')
        .trim()
        .toLowerCase();
      const templateNeedle = String(input.templateQuery || '')
        .trim()
        .toLowerCase();
      const queryLooksLikeTemplate =
        !templateNeedle &&
        /quantum\s*hire|cart\s*n\s*tip|template|layout/i.test(String(input.query || ''));
      const effectiveTemplateNeedle =
        templateNeedle ||
        (queryLooksLikeTemplate
          ? q.replace(/\b(template|layout|invoice)\b/g, '').trim()
          : '');

      const filter: {
        customerId?: string;
        status?: 'Draft' | 'Finalised';
        paymentState?: 'Draft' | 'Sent' | 'Awaiting Payment' | 'Paid' | 'Cancelled';
      } = {};
      if (input.customerId) filter.customerId = input.customerId;
      // Template/"most recent Quantum Hire" lookups must include Finalised sources.
      // Models often pass status=Draft because the *result* should be a draft — ignore that.
      if (input.status && !effectiveTemplateNeedle) filter.status = input.status;
      if (input.paymentState) filter.paymentState = input.paymentState;

      const invoices = await ctx.db.listInvoices(filter, {
        limit: Math.max(input.limit, 100),
        offset: 0,
      });
      const templates = await listInvoiceTemplates(ctx.db);
      const templateById = new Map(templates.map((item) => [item.id, item]));

      const enriched = await Promise.all(
        invoices.map(async (item) => {
          const templateId = await getInvoiceTemplateBinding(ctx.db, item.id);
          const template = templateId ? templateById.get(templateId) : null;
          return {
            ...item,
            templateId: templateId || null,
            templateName: template?.name || null,
          };
        }),
      );

      let filtered = enriched;
      if (effectiveTemplateNeedle) {
        filtered = filtered.filter((item) =>
          (item.templateName || '').toLowerCase().includes(effectiveTemplateNeedle),
        );
      } else if (q) {
        filtered = filtered.filter((item) => {
          const hay = `${item.title} ${item.invoiceNumber || ''} ${item.id}`.toLowerCase();
          return hay.includes(q);
        });
      }
      filtered = filtered.slice(0, input.limit);
      return {
        ok: true,
        data: {
          invoices: filtered.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            invoiceNumber: item.invoiceNumber,
            customerId: item.customerId,
            issueDate: item.issueDate,
            dueDate: item.dueDate,
            templateId: item.templateId,
            templateName: item.templateName,
            totals: item.totals,
          })),
          count: filtered.length,
          ignoredStatusFilterForTemplateSearch: Boolean(effectiveTemplateNeedle && input.status),
        },
        summary: `Found ${filtered.length} invoice(s).`,
        ui: { refresh: ['invoices'] },
      };
    },
  });

  registry.register({
    name: 'get_invoice',
    description: 'Load a full invoice including line items, totals, and bound template id.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({ invoiceId: z.string().uuid() }),
    async execute(input, ctx) {
      const invoice = await ctx.db.getInvoiceById(input.invoiceId);
      if (!invoice) {
        return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      }
      const templateId = await getInvoiceTemplateBinding(ctx.db, invoice.id);
      return {
        ok: true,
        data: { ...invoice, templateId },
        summary: `Loaded invoice ${invoice.invoiceNumber || invoice.id}.`,
        ui: { focusInvoiceId: invoice.id },
      };
    },
  });

  registry.register({
    name: 'create_invoice_draft',
    description:
      'Create a new draft invoice with line items. Uses sensible dates/terms when omitted.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'snapshot',
    inputSchema: z.object({
      customerId: z.string().uuid(),
      title: z.string().min(1),
      issueDate: z.string().optional(),
      dueDate: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
      templateId: z.string().uuid().nullable().optional(),
      lineItems: z.array(lineItemSchema).min(1),
    }),
    async execute(input, ctx) {
      const issueDate = input.issueDate || todayIso(ctx.now());
      const dueDate = input.dueDate || addDaysIso(issueDate, 7);
      const invoice = await ctx.db.createInvoiceDraft({
        customerId: input.customerId,
        title: input.title,
        issueDate,
        dueDate,
        paymentTerms: input.paymentTerms || '7 Days',
        notes: input.notes,
        lineItems: input.lineItems,
      });
      if (input.templateId) {
        await setInvoiceTemplateBinding(ctx.db, invoice.id, input.templateId);
      }
      return {
        ok: true,
        data: { invoice },
        summary: `Created draft invoice "${invoice.title}".`,
        decisions: [
          !input.issueDate ? `Issue date defaulted to ${issueDate}.` : null,
          !input.dueDate ? `Due date defaulted to ${dueDate}.` : null,
        ].filter(Boolean) as string[],
        ui: { refresh: ['invoices'], focusInvoiceId: invoice.id, openRoute: `/workspace/invoices/${invoice.id}/edit` },
      };
    },
  });

  registry.register({
    name: 'update_invoice_draft',
    description:
      'Update an existing draft invoice (title, dates, notes, terms, payment state, lines, template).',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'snapshot',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      title: z.string().min(1).optional(),
      issueDate: z.string().optional(),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
      paymentTerms: z.string().optional(),
      paymentState: z
        .enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled'])
        .optional(),
      templateId: z.string().uuid().nullable().optional(),
      lineItems: z.array(lineItemSchema).min(1).optional(),
    }),
    async execute(input, ctx) {
      const existing = await ctx.db.getInvoiceById(input.invoiceId);
      if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      if (existing.status !== 'Draft') {
        return {
          ok: false,
          code: 'NOT_DRAFT',
          message: 'Only draft invoices can be edited. Finalise/status tools handle issued invoices.',
        };
      }
      await pushInvoiceUndoSnapshot(ctx, existing.id, `Before update of ${existing.title}`, 'update_invoice_draft');
      const updated = await ctx.db.updateInvoiceDraft(existing.id, {
        title: input.title ?? existing.title,
        issueDate: input.issueDate ?? existing.issueDate,
        dueDate: input.dueDate ?? existing.dueDate,
        notes: input.notes ?? existing.notes ?? undefined,
        paymentTerms: input.paymentTerms ?? existing.paymentTerms ?? undefined,
        paymentState: input.paymentState ?? existing.paymentState,
        lineItems: input.lineItems ?? existing.lineItems,
      });
      if (input.templateId !== undefined) {
        await setInvoiceTemplateBinding(ctx.db, existing.id, input.templateId);
      }
      return {
        ok: true,
        data: { invoice: updated },
        summary: `Updated draft invoice "${updated.title}".`,
        ui: { refresh: ['invoices'], focusInvoiceId: updated.id },
      };
    },
  });

  registry.register({
    name: 'manage_invoice_lines',
    description:
      'Add, replace, reorder, or remove line items on a draft invoice. Prefer this for line-level edits.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'snapshot',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      mode: z.enum(['replace', 'append', 'remove_indexes']),
      lineItems: z.array(lineItemSchema).optional(),
      removeIndexes: z.array(z.number().int().nonnegative()).optional(),
    }),
    async execute(input, ctx) {
      const existing = await ctx.db.getInvoiceById(input.invoiceId);
      if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      if (existing.status !== 'Draft') {
        return { ok: false, code: 'NOT_DRAFT', message: 'Only draft invoices accept line edits.' };
      }
      await pushInvoiceUndoSnapshot(ctx, existing.id, `Before line edit on ${existing.title}`, 'manage_invoice_lines');
      let next = [...existing.lineItems];
      if (input.mode === 'replace') {
        if (!input.lineItems?.length) {
          return { ok: false, code: 'INVALID_INPUT', message: 'replace requires lineItems.' };
        }
        next = input.lineItems;
      } else if (input.mode === 'append') {
        if (!input.lineItems?.length) {
          return { ok: false, code: 'INVALID_INPUT', message: 'append requires lineItems.' };
        }
        next = [...next, ...input.lineItems];
      } else {
        const remove = new Set(input.removeIndexes || []);
        next = next.filter((_, index) => !remove.has(index));
      }
      if (!next.length) {
        return { ok: false, code: 'EMPTY_LINES', message: 'An invoice needs at least one line item.' };
      }
      const updated = await ctx.db.updateInvoiceDraft(existing.id, {
        title: existing.title,
        issueDate: existing.issueDate,
        dueDate: existing.dueDate,
        notes: existing.notes ?? undefined,
        paymentTerms: existing.paymentTerms ?? undefined,
        paymentState: existing.paymentState,
        lineItems: next,
      });
      return {
        ok: true,
        data: { invoice: updated, totals: updated.totals },
        summary: `Updated line items on "${updated.title}" (${next.length} lines).`,
        ui: { refresh: ['invoices'], focusInvoiceId: updated.id },
      };
    },
  });

  registry.register({
    name: 'recalculate_invoice_totals',
    description: 'Recalculate and explain GST/subtotal/total for an invoice or proposed lines.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      invoiceId: z.string().uuid().optional(),
      lineItems: z.array(lineItemSchema).optional(),
    }),
    async execute(input, ctx) {
      let lines = input.lineItems;
      if (!lines && input.invoiceId) {
        const invoice = await ctx.db.getInvoiceById(input.invoiceId);
        if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
        lines = invoice.lineItems;
      }
      if (!lines?.length) {
        return { ok: false, code: 'INVALID_INPUT', message: 'Provide invoiceId or lineItems.' };
      }
      const { calculatedItems, totals } = calculateTotals(lines);
      return {
        ok: true,
        data: { calculatedItems, totals },
        summary: `Subtotal $${totals.subtotal.toFixed(2)}, GST $${totals.gstTotal.toFixed(2)}, total $${totals.total.toFixed(2)}.`,
      };
    },
  });

  registry.register({
    name: 'duplicate_invoice',
    description: 'Duplicate an invoice into a new draft, optionally for another customer.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      customerId: z.string().uuid().optional(),
      titleSuffix: z.string().optional(),
    }),
    async execute(input, ctx) {
      const source = await ctx.db.getInvoiceById(input.invoiceId);
      if (!source) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      const templateId = await getInvoiceTemplateBinding(ctx.db, source.id);
      const issueDate = todayIso(ctx.now());
      const created = await ctx.db.createInvoiceDraft({
        customerId: input.customerId || source.customerId,
        title: `${source.title}${input.titleSuffix || ' (copy)'}`,
        issueDate,
        dueDate: addDaysIso(issueDate, 7),
        paymentTerms: source.paymentTerms || '7 Days',
        notes: source.notes || undefined,
        lineItems: source.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          gstApplicable: item.gstApplicable,
          productId: item.productId ?? null,
        })),
      });
      if (templateId) await setInvoiceTemplateBinding(ctx.db, created.id, templateId);
      return {
        ok: true,
        data: { invoice: created, sourceInvoiceId: source.id },
        summary: `Duplicated into draft "${created.title}".`,
        ui: { refresh: ['invoices'], focusInvoiceId: created.id },
      };
    },
  });

  registry.register({
    name: 'reuse_previous_invoice',
    description:
      'Create a new draft by reusing line items/rates/notes from a previous invoice for a customer (defaults to most recent).',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      customerId: z.string().uuid(),
      sourceInvoiceId: z.string().uuid().optional(),
      title: z.string().optional(),
      keepQuantities: z.boolean().default(true),
      keepRates: z.boolean().default(true),
    }),
    async execute(input, ctx) {
      let sourceId = input.sourceInvoiceId || null;
      if (!sourceId) {
        const list = await ctx.db.listInvoices(
          { customerId: input.customerId },
          { limit: 20, offset: 0 },
        );
        sourceId =
          list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
      }
      const source = sourceId ? await ctx.db.getInvoiceById(sourceId) : null;
      if (!source) {
        return { ok: false, code: 'NOT_FOUND', message: 'No previous invoice found for customer.' };
      }
      const issueDate = todayIso(ctx.now());
      const created = await ctx.db.createInvoiceDraft({
        customerId: input.customerId,
        title: input.title || `${source.title} (reused)`,
        issueDate,
        dueDate: addDaysIso(issueDate, 7),
        paymentTerms: source.paymentTerms || '7 Days',
        notes: source.notes || undefined,
        lineItems: source.lineItems.map((item) => ({
          description: item.description,
          quantity: input.keepQuantities ? item.quantity : 1,
          unitPrice: input.keepRates ? item.unitPrice : 0,
          gstApplicable: item.gstApplicable,
          productId: item.productId ?? null,
        })),
      });
      const templateId = await getInvoiceTemplateBinding(ctx.db, source.id);
      if (templateId) await setInvoiceTemplateBinding(ctx.db, created.id, templateId);
      return {
        ok: true,
        data: { invoice: created, reusedFrom: source.id },
        summary: `Created draft from previous invoice ${source.invoiceNumber || source.id}.`,
        ui: { refresh: ['invoices'], focusInvoiceId: created.id },
      };
    },
  });

  registry.register({
    name: 'set_invoice_template',
    description: 'Bind an invoice template (including Quantum Hire / Cart N Tip) to a draft invoice.',
    category: 'templates',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'snapshot',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      templateId: z.string().uuid().nullable(),
    }),
    async execute(input, ctx) {
      const invoice = await ctx.db.getInvoiceById(input.invoiceId);
      if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      if (invoice.status !== 'Draft') {
        return { ok: false, code: 'NOT_DRAFT', message: 'Template binding is for drafts.' };
      }
      await pushInvoiceUndoSnapshot(ctx, invoice.id, 'Before template change', 'set_invoice_template');
      await setInvoiceTemplateBinding(ctx.db, invoice.id, input.templateId);
      return {
        ok: true,
        data: { invoiceId: invoice.id, templateId: input.templateId },
        summary: input.templateId
          ? `Bound template ${input.templateId} to invoice.`
          : 'Cleared invoice template binding.',
        ui: { refresh: ['invoices', 'templates'], focusInvoiceId: invoice.id },
      };
    },
  });

  registry.register({
    name: 'list_templates',
    description: 'List invoice templates available to the authenticated business.',
    category: 'templates',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const templates = await listInvoiceTemplates(ctx.db);
      return {
        ok: true,
        data: {
          templates: templates.map((item) => ({
            id: item.id,
            name: item.name,
            isDefault: item.isDefault,
            layoutPreset: item.design?.layout?.layoutPreset || 'standard',
          })),
        },
        summary: `${templates.length} template(s) available.`,
        ui: { refresh: ['templates'] },
      };
    },
  });

  registry.register({
    name: 'finalise_invoice',
    description: 'Finalise a draft invoice (assigns invoice number, locks content). Requires confirmation.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
    }),
    async execute(input, ctx) {
      const existing = await ctx.db.getInvoiceById(input.invoiceId);
      if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      if (existing.status !== 'Draft') {
        return { ok: false, code: 'ALREADY_FINAL', message: 'Invoice is already finalised.' };
      }
      const finalised = await ctx.db.finaliseInvoice(existing.id);
      return {
        ok: true,
        data: { invoice: finalised },
        summary: `Finalised invoice ${finalised.invoiceNumber}.`,
        ui: { refresh: ['invoices'], focusInvoiceId: finalised.id },
      };
    },
  });

  registry.register({
    name: 'set_invoice_payment_state',
    description:
      'Change payment/status state on an invoice (Sent, Awaiting Payment, Paid, Cancelled). Requires confirmation.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      paymentState: z.enum(['Sent', 'Awaiting Payment', 'Paid', 'Cancelled']),
    }),
    async execute(input, ctx) {
      const existing = await ctx.db.getInvoiceById(input.invoiceId);
      if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      if (existing.status !== 'Draft' && existing.status !== 'Finalised') {
        return { ok: false, code: 'INVALID_STATE', message: 'Invoice cannot change payment state.' };
      }
      if (existing.status === 'Draft') {
        const updated = await ctx.db.updateInvoiceDraft(existing.id, {
          title: existing.title,
          issueDate: existing.issueDate,
          dueDate: existing.dueDate,
          notes: existing.notes ?? undefined,
          paymentTerms: existing.paymentTerms ?? undefined,
          paymentState: input.paymentState,
          lineItems: existing.lineItems,
        });
        return {
          ok: true,
          data: { invoice: updated },
          summary: `Set draft payment state to ${input.paymentState}.`,
          ui: { refresh: ['invoices'], focusInvoiceId: updated.id },
        };
      }
      // Finalised invoices: update payment state via draft update path is blocked.
      // Use a narrow DB path if available — fall back to error with guidance.
      try {
        const updated = await (ctx.db as { updateInvoicePaymentState?: Function }).updateInvoicePaymentState?.(
          existing.id,
          input.paymentState,
        );
        if (updated) {
          return {
            ok: true,
            data: { invoice: updated },
            summary: `Set payment state to ${input.paymentState}.`,
            ui: { refresh: ['invoices'], focusInvoiceId: existing.id },
          };
        }
      } catch {
        /* fall through */
      }
      return {
        ok: false,
        code: 'UNSUPPORTED',
        message:
          'Payment state changes for finalised invoices should use record_payment or the payments UI when direct mutation is unavailable.',
      };
    },
  });

  registry.register({
    name: 'delete_invoice_draft',
    description: 'Delete a draft invoice. Requires confirmation.',
    category: 'invoices',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'none',
    inputSchema: z.object({ invoiceId: z.string().uuid() }),
    async execute(input, ctx) {
      await ctx.db.deleteInvoiceDraft(input.invoiceId);
      return {
        ok: true,
        data: { invoiceId: input.invoiceId },
        summary: 'Deleted draft invoice.',
        ui: { refresh: ['invoices'] },
      };
    },
  });

  registry.register({
    name: 'prepare_invoice_pdf',
    description: 'Generate/export the invoice PDF and return a download path plus byte size.',
    category: 'pdf',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({ invoiceId: z.string().uuid() }),
    async execute(input, ctx) {
      const invoice = await ctx.db.getInvoiceById(input.invoiceId);
      if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      const customer = await ctx.db.getCustomerById(invoice.customerId);
      if (!customer) return { ok: false, code: 'CUSTOMER_MISSING', message: 'Invoice customer missing.' };
      const businessProfile = await ctx.db.getBusinessProfile();
      const { resolveInvoiceTemplateForPdf } = await import(
        '../../domain/templates/invoice-template-store.js'
      );
      const template = await resolveInvoiceTemplateForPdf(ctx.db, invoice.id);
      const pdf = await generateInvoicePdfBuffer({
        invoice,
        lineItems: invoice.lineItems,
        customer,
        businessProfile,
        templateDesign: template?.design || null,
      });
      return {
        ok: true,
        data: {
          invoiceId: invoice.id,
          bytes: pdf.byteLength,
          downloadPath: `/api/invoices/${invoice.id}/pdf`,
        },
        summary: `Prepared PDF (${pdf.byteLength} bytes) for ${invoice.invoiceNumber || invoice.title}.`,
        ui: { focusInvoiceId: invoice.id },
      };
    },
  });

  registry.register({
    name: 'prepare_invoice_email',
    description:
      'Prepare an email draft (subject/body/attachment path) for an invoice. Does not send.',
    category: 'email',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      invoiceId: z.string().uuid(),
      toEmail: z.string().email().optional(),
      note: z.string().optional(),
    }),
    async execute(input, ctx) {
      const invoice = await ctx.db.getInvoiceById(input.invoiceId);
      if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found.' };
      const customer = await ctx.db.getCustomerById(invoice.customerId);
      const profile = await ctx.db.getBusinessProfile();
      const to = input.toEmail || customer?.email;
      if (!to) {
        return {
          ok: false,
          code: 'MISSING_EMAIL',
          message: 'Customer has no email; provide toEmail.',
        };
      }
      const number = invoice.invoiceNumber || 'Draft';
      const subject = `Tax invoice ${number} from ${profile?.companyName || 'our business'}`;
      const body = [
        `Hi ${customer?.displayName || 'there'},`,
        '',
        `Please find tax invoice ${number} for ${invoice.title}.`,
        `Amount due: $${Number(invoice.totals.total || 0).toFixed(2)}.`,
        `Due date: ${invoice.dueDate}.`,
        input.note || '',
        '',
        'Regards,',
        profile?.companyName || 'Accounts',
      ]
        .filter((line) => line !== undefined)
        .join('\n');
      return {
        ok: true,
        data: {
          to,
          subject,
          body,
          attachmentPath: `/api/invoices/${invoice.id}/pdf`,
          sent: false,
        },
        summary: `Prepared email to ${to} (not sent).`,
        decisions: ['Email left unsent as required for prepare-only actions.'],
      };
    },
  });

  registry.register({
    name: 'bulk_update_invoices',
    description:
      'Apply the same reversible draft updates across many invoices matching a filter. Requires confirmation.',
    category: 'bulk',
    milestone: 'M1',
    confirmation: 'required',
    undo: 'snapshot',
    inputSchema: z.object({
      invoiceIds: z.array(z.string().uuid()).min(1).max(50),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
      templateId: z.string().uuid().nullable().optional(),
      forceGstOnLabourLines: z.boolean().optional(),
    }),
    async execute(input, ctx) {
      const successes: string[] = [];
      const failures: Array<{ invoiceId: string; message: string }> = [];
      for (const invoiceId of input.invoiceIds) {
        try {
          const existing = await ctx.db.getInvoiceById(invoiceId);
          if (!existing) {
            failures.push({ invoiceId, message: 'Not found' });
            continue;
          }
          if (existing.status !== 'Draft') {
            failures.push({ invoiceId, message: 'Not a draft' });
            continue;
          }
          await pushInvoiceUndoSnapshot(ctx, existing.id, `Bulk before ${existing.title}`, 'bulk_update_invoices');
          let lineItems = existing.lineItems;
          if (input.forceGstOnLabourLines) {
            lineItems = lineItems.map((item) =>
              /labour/i.test(item.description) ? { ...item, gstApplicable: true } : item,
            );
          }
          await ctx.db.updateInvoiceDraft(existing.id, {
            title: existing.title,
            issueDate: existing.issueDate,
            dueDate: existing.dueDate,
            notes: input.notes ?? existing.notes ?? undefined,
            paymentTerms: input.paymentTerms ?? existing.paymentTerms ?? undefined,
            paymentState: existing.paymentState,
            lineItems,
          });
          if (input.templateId !== undefined) {
            await setInvoiceTemplateBinding(ctx.db, existing.id, input.templateId);
          }
          successes.push(invoiceId);
        } catch (error) {
          failures.push({
            invoiceId,
            message: error instanceof Error ? error.message : 'Update failed',
          });
        }
      }
      return {
        ok: true,
        data: { successes, failures },
        summary: `Updated ${successes.length} invoice(s)${failures.length ? `; ${failures.length} failed` : ''}.`,
        ui: { refresh: ['invoices'] },
      };
    },
  });

  registry.register({
    name: 'bulk_create_drafts_from_rows',
    description:
      'Create multiple draft invoices from structured rows (CSV/spreadsheet-like). Does not finalise.',
    category: 'bulk',
    milestone: 'M1',
    confirmation: 'none',
    undo: 'none',
    inputSchema: z.object({
      rows: z
        .array(
          z.object({
            customerId: z.string().uuid(),
            title: z.string().min(1),
            issueDate: z.string().optional(),
            dueDate: z.string().optional(),
            paymentTerms: z.string().optional(),
            notes: z.string().optional(),
            templateId: z.string().uuid().nullable().optional(),
            lineItems: z.array(lineItemSchema).min(1),
          }),
        )
        .min(1)
        .max(50),
      finaliseFirstOnly: z.boolean().default(false),
    }),
    async execute(input, ctx) {
      // finaliseFirstOnly needs confirmation — handled by calling finalise_invoice separately
      // after create when user confirms, or we create drafts only here.
      const created: string[] = [];
      const failures: Array<{ index: number; message: string }> = [];
      for (const [index, row] of input.rows.entries()) {
        try {
          const issueDate = row.issueDate || todayIso(ctx.now());
          const invoice = await ctx.db.createInvoiceDraft({
            customerId: row.customerId,
            title: row.title,
            issueDate,
            dueDate: row.dueDate || addDaysIso(issueDate, 7),
            paymentTerms: row.paymentTerms || '7 Days',
            notes: row.notes,
            lineItems: row.lineItems,
          });
          if (row.templateId) await setInvoiceTemplateBinding(ctx.db, invoice.id, row.templateId);
          created.push(invoice.id);
        } catch (error) {
          failures.push({
            index,
            message: error instanceof Error ? error.message : 'Create failed',
          });
        }
      }
      const result: {
        ok: true;
        data: { created: string[]; failures: Array<{ index: number; message: string }>; finaliseFirstOnly: boolean };
        summary: string;
        ui: { refresh: Array<'invoices'> };
        decisions?: string[];
      } = {
        ok: true,
        data: { created, failures, finaliseFirstOnly: input.finaliseFirstOnly },
        summary: `Created ${created.length} draft(s)${failures.length ? `; ${failures.length} failed` : ''}.`,
        ui: { refresh: ['invoices'] },
      };
      if (input.finaliseFirstOnly) {
        result.decisions = [
          'Drafts created only. Call finalise_invoice on the first id after confirmation if finalisation was requested.',
        ];
      }
      return result;
    },
  });
}
