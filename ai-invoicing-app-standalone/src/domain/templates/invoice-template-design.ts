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
  'watermark',
] as const;

export type TemplateSectionType = (typeof TEMPLATE_SECTION_TYPES)[number];

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
  }),
  businessDefaults: z.object({
    companyName: z.string().max(160).nullable(),
    legalName: z.string().max(160).nullable(),
    abnTaxId: z.string().max(40).nullable(),
    address: z.string().max(400).nullable(),
    email: z.string().max(160).nullable(),
    phone: z.string().max(60).nullable(),
    website: z.string().max(200).nullable(),
    logoDataUrl: z.string().max(2_000_000).nullable().optional(),
  }),
  paymentDetails: z.string().max(2000).nullable(),
  termsAndConditions: z.string().max(4000).nullable(),
  notesPlaceholder: z.string().max(2000).nullable(),
  borders: z.object({
    table: z.boolean(),
    headerRule: z.boolean(),
    width: z.number().min(0.5).max(4),
  }),
  watermark: z
    .object({
      text: z.string().max(80).nullable(),
      opacity: z.number().min(0).max(1),
    })
    .nullable(),
  analysisNotes: z.array(z.string()).default([]),
});

export type InvoiceTemplateDesign = z.infer<typeof invoiceTemplateDesignSchema>;

export const DOCUMENT_TEMPLATE_TARGETS = [
  'invoice',
  'quote',
  'credit_note',
  'statement',
  'receipt',
] as const;

export type DocumentTemplateTarget = (typeof DOCUMENT_TEMPLATE_TARGETS)[number];

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
    },
    businessDefaults: {
      companyName: null,
      legalName: null,
      abnTaxId: null,
      address: null,
      email: null,
      phone: null,
      website: null,
      logoDataUrl: null,
    },
    paymentDetails: null,
    termsAndConditions: null,
    notesPlaceholder: null,
    borders: { table: true, headerRule: true, width: 1 },
    watermark: null,
    analysisNotes: [],
  };
  return invoiceTemplateDesignSchema.parse({
    ...base,
    ...overrides,
    colors: { ...base.colors, ...(overrides.colors || {}) },
    typography: { ...base.typography, ...(overrides.typography || {}) },
    layout: {
      margins: { ...base.layout.margins, ...(overrides.layout?.margins || {}) },
      sections: overrides.layout?.sections || base.layout.sections,
    },
    businessDefaults: { ...base.businessDefaults, ...(overrides.businessDefaults || {}) },
    borders: { ...base.borders, ...(overrides.borders || {}) },
  });
}
