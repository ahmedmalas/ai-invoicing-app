import { z } from 'zod';

export const TEMPLATE_SECTION_TYPES = [
  'header',
  'logo',
  'businessDetails',
  'invoiceMeta',
  'customer',
  'lineItems',
  'totals',
  'gst',
  'payment',
  'terms',
  'notes',
  'footer',
] as const;

export type TemplateSectionType = (typeof TEMPLATE_SECTION_TYPES)[number];

export const TABLE_COLUMN_IDS = [
  'lineNumber',
  'date',
  'description',
  'quantity',
  'unitPrice',
  'gst',
  'amount',
] as const;

export const invoiceTemplateDesignSchema = z.object({
  version: z.literal(1),
  documentTitle: z.string().min(1).max(80).default('TAX INVOICE'),
  colors: z.object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    text: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    muted: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    border: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  typography: z.object({
    headingFont: z.enum(['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Courier']),
    bodyFont: z.enum(['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Courier']),
    titleSize: z.number().min(10).max(36),
    headingSize: z.number().min(8).max(24),
    bodySize: z.number().min(7).max(16),
  }),
  layout: z.object({
    margins: z.object({
      top: z.number().min(24).max(96),
      right: z.number().min(24).max(96),
      bottom: z.number().min(24).max(96),
      left: z.number().min(24).max(96),
    }),
    /** Cart N Tip style uses split Bill To / From columns. */
    headerStyle: z.enum(['stacked', 'split-bill-from', 'meta-right']).default('meta-right'),
    logoPosition: z.enum(['left', 'right', 'none']).default('left'),
    /** Named layout engine. quantum-hire matches the supplied Cart N Tip #107 invoice. */
    layoutPreset: z.enum(['standard', 'quantum-hire']).default('standard'),
    sections: z.array(
      z.object({
        id: z.string().min(1),
        type: z.enum(TEMPLATE_SECTION_TYPES),
        order: z.number().int().min(0),
        align: z.enum(['left', 'center', 'right']).default('left'),
        visible: z.boolean().default(true),
        label: z.string().max(80).optional(),
      }),
    ),
    tableColumns: z
      .array(
        z.object({
          id: z.enum(TABLE_COLUMN_IDS),
          label: z.string().min(1).max(40),
          visible: z.boolean().default(true),
        }),
      )
      .default([]),
  }),
  businessDefaults: z.object({
    companyName: z.string().max(160).nullable(),
    legalName: z.string().max(160).nullable(),
    abnTaxId: z.string().max(40).nullable(),
    address: z.string().max(400).nullable(),
    email: z.string().max(160).nullable(),
    phone: z.string().max(60).nullable(),
    website: z.string().max(200).nullable(),
  }),
  bankDetails: z
    .object({
      accountName: z.string().max(160).nullable(),
      bsb: z.string().max(20).nullable(),
      accountNumber: z.string().max(40).nullable(),
      referenceLabel: z.string().max(80).nullable(),
    })
    .nullable(),
  paymentDetails: z.string().max(2000).nullable(),
  termsAndConditions: z.string().max(4000).nullable(),
  notesPlaceholder: z.string().max(2000).nullable(),
  borders: z.object({
    table: z.boolean(),
    headerRule: z.boolean(),
    width: z.number().min(0.5).max(4),
  }),
  analysisNotes: z.array(z.string()).default([]),
});

export type InvoiceTemplateDesign = z.infer<typeof invoiceTemplateDesignSchema>;

export function defaultInvoiceTemplateDesign(
  overrides: Partial<InvoiceTemplateDesign> = {},
): InvoiceTemplateDesign {
  const base: InvoiceTemplateDesign = {
    version: 1,
    documentTitle: 'TAX INVOICE',
    colors: {
      primary: '#173f35',
      secondary: '#c4f36b',
      accent: '#0f2d26',
      text: '#111827',
      muted: '#6b7280',
      border: '#d1d5db',
      background: '#ffffff',
    },
    typography: {
      headingFont: 'Helvetica-Bold',
      bodyFont: 'Helvetica',
      titleSize: 18,
      headingSize: 12,
      bodySize: 10,
    },
    layout: {
      margins: { top: 48, right: 48, bottom: 48, left: 48 },
      headerStyle: 'meta-right',
      logoPosition: 'left',
      layoutPreset: 'standard',
      sections: [
        { id: 'logo', type: 'logo', order: 0, align: 'left', visible: true },
        { id: 'business', type: 'businessDetails', order: 1, align: 'left', visible: true },
        { id: 'title', type: 'header', order: 2, align: 'right', visible: true, label: 'TAX INVOICE' },
        { id: 'meta', type: 'invoiceMeta', order: 3, align: 'right', visible: true },
        { id: 'customer', type: 'customer', order: 4, align: 'left', visible: true, label: 'Bill To' },
        { id: 'lines', type: 'lineItems', order: 5, align: 'left', visible: true },
        { id: 'totals', type: 'totals', order: 6, align: 'right', visible: true },
        { id: 'gst', type: 'gst', order: 7, align: 'right', visible: true },
        { id: 'payment', type: 'payment', order: 8, align: 'left', visible: true, label: 'Payment details' },
        { id: 'terms', type: 'terms', order: 9, align: 'left', visible: true, label: 'Terms & Conditions' },
        { id: 'notes', type: 'notes', order: 10, align: 'left', visible: true, label: 'Notes' },
        { id: 'footer', type: 'footer', order: 11, align: 'center', visible: true },
      ],
      tableColumns: [
        { id: 'lineNumber', label: '#', visible: true },
        { id: 'date', label: 'Date', visible: false },
        { id: 'description', label: 'Description', visible: true },
        { id: 'quantity', label: 'Qty', visible: true },
        { id: 'unitPrice', label: 'Unit', visible: true },
        { id: 'gst', label: 'GST', visible: true },
        { id: 'amount', label: 'Total', visible: true },
      ],
    },
    businessDefaults: {
      companyName: null,
      legalName: null,
      abnTaxId: null,
      address: null,
      email: null,
      phone: null,
      website: null,
    },
    bankDetails: null,
    paymentDetails: null,
    termsAndConditions: null,
    notesPlaceholder: null,
    borders: { table: true, headerRule: true, width: 1 },
    analysisNotes: [],
  };

  return invoiceTemplateDesignSchema.parse({
    ...base,
    ...overrides,
    colors: { ...base.colors, ...(overrides.colors || {}) },
    typography: { ...base.typography, ...(overrides.typography || {}) },
    layout: {
      ...base.layout,
      ...(overrides.layout || {}),
      margins: { ...base.layout.margins, ...(overrides.layout?.margins || {}) },
      sections: overrides.layout?.sections || base.layout.sections,
      tableColumns: overrides.layout?.tableColumns?.length
        ? overrides.layout.tableColumns
        : base.layout.tableColumns,
    },
    businessDefaults: { ...base.businessDefaults, ...(overrides.businessDefaults || {}) },
    bankDetails:
      overrides.bankDetails === undefined
        ? base.bankDetails
        : overrides.bankDetails
          ? { ...(base.bankDetails || {}), ...overrides.bankDetails }
          : null,
    borders: { ...base.borders, ...(overrides.borders || {}) },
  });
}
