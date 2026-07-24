import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '../../db/database.js';
import {
  createInvoiceTemplateSchema,
  invoiceTemplateSchema,
  updateInvoiceTemplateSchema,
  type CreateInvoiceTemplateInput,
  type InvoiceTemplate,
  type UpdateInvoiceTemplateInput,
} from './invoice-template.js';

export const INVOICE_TEMPLATES_PREFERENCE_KEY = 'invoice_templates_v1';

type TemplateStorePayload = {
  version: 1;
  templates: InvoiceTemplate[];
};

function nowIso(): string {
  return new Date().toISOString();
}

async function readStore(db: AppDatabase): Promise<TemplateStorePayload> {
  const raw = await db.getPreference(INVOICE_TEMPLATES_PREFERENCE_KEY);
  if (!raw || typeof raw !== 'object') return { version: 1, templates: [] };
  const templates = Array.isArray((raw as TemplateStorePayload).templates)
    ? (raw as TemplateStorePayload).templates
        .map((item) => {
          try {
            return invoiceTemplateSchema.parse(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
  return { version: 1, templates: templates as InvoiceTemplate[] };
}

async function writeStore(db: AppDatabase, store: TemplateStorePayload): Promise<void> {
  await db.upsertPreference(INVOICE_TEMPLATES_PREFERENCE_KEY, store);
}

export async function listInvoiceTemplates(db: AppDatabase): Promise<InvoiceTemplate[]> {
  const store = await readStore(db);
  return [...store.templates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getInvoiceTemplateById(
  db: AppDatabase,
  id: string,
): Promise<InvoiceTemplate | null> {
  const store = await readStore(db);
  return store.templates.find((item) => item.id === id) || null;
}

export async function getDefaultInvoiceTemplate(
  db: AppDatabase,
): Promise<InvoiceTemplate | null> {
  const store = await readStore(db);
  return store.templates.find((item) => item.isDefault) || store.templates[0] || null;
}

export async function createInvoiceTemplate(
  db: AppDatabase,
  input: CreateInvoiceTemplateInput,
): Promise<InvoiceTemplate> {
  const parsed = createInvoiceTemplateSchema.parse(input);
  const store = await readStore(db);
  const now = nowIso();
  const template: InvoiceTemplate = invoiceTemplateSchema.parse({
    id: randomUUID(),
    name: parsed.name,
    isDefault: parsed.isDefault || store.templates.length === 0,
    design: parsed.design,
    originalFilename: parsed.originalFilename ?? null,
    originalMimeType: parsed.originalMimeType ?? null,
    originalPreviewDataUrl: parsed.originalPreviewDataUrl ?? null,
    source: parsed.source,
    createdAt: now,
    updatedAt: now,
  });

  let templates = store.templates;
  if (template.isDefault) {
    templates = templates.map((item) => ({ ...item, isDefault: false }));
  }
  templates = [template, ...templates];
  await writeStore(db, { version: 1, templates });

  if (parsed.applyBusinessDefaults) {
    const defaults = parsed.design.businessDefaults;
    const existing = await db.getBusinessProfile();
    await db.upsertBusinessProfile({
      companyName: defaults.companyName || existing?.companyName || 'Business Name',
      legalName: defaults.legalName || existing?.legalName || undefined,
      abnTaxId: defaults.abnTaxId || existing?.abnTaxId || undefined,
      address: defaults.address || existing?.address || undefined,
      email: defaults.email || existing?.email || undefined,
      phone: defaults.phone || existing?.phone || undefined,
      logoReference: existing?.logoReference || undefined,
      primaryColor: parsed.design.colors.primary,
      secondaryColor: parsed.design.colors.secondary,
    });
  }

  return template;
}

export async function updateInvoiceTemplate(
  db: AppDatabase,
  id: string,
  input: UpdateInvoiceTemplateInput,
): Promise<InvoiceTemplate> {
  const parsed = updateInvoiceTemplateSchema.parse(input);
  const store = await readStore(db);
  const index = store.templates.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('INVOICE_TEMPLATE_NOT_FOUND');
  let templates = [...store.templates];
  const current = templates[index]!;
  const next: InvoiceTemplate = invoiceTemplateSchema.parse({
    ...current,
    name: parsed.name ?? current.name,
    isDefault: parsed.isDefault ?? current.isDefault,
    design: parsed.design ?? current.design,
    updatedAt: nowIso(),
  });
  if (next.isDefault) {
    templates = templates.map((item) => ({ ...item, isDefault: item.id === id }));
  }
  templates[index] = next;
  await writeStore(db, { version: 1, templates });
  return next;
}

export async function setDefaultInvoiceTemplate(
  db: AppDatabase,
  id: string,
): Promise<InvoiceTemplate> {
  return updateInvoiceTemplate(db, id, { isDefault: true });
}

export async function deleteInvoiceTemplate(db: AppDatabase, id: string): Promise<void> {
  const store = await readStore(db);
  const remaining = store.templates.filter((item) => item.id !== id);
  if (remaining.length === store.templates.length) throw new Error('INVOICE_TEMPLATE_NOT_FOUND');
  if (!remaining.some((item) => item.isDefault) && remaining[0]) {
    remaining[0] = { ...remaining[0], isDefault: true, updatedAt: nowIso() };
  }
  await writeStore(db, { version: 1, templates: remaining });
}

export async function duplicateInvoiceTemplate(
  db: AppDatabase,
  id: string,
): Promise<InvoiceTemplate> {
  const existing = await getInvoiceTemplateById(db, id);
  if (!existing) throw new Error('INVOICE_TEMPLATE_NOT_FOUND');
  return createInvoiceTemplate(db, {
    name: `${existing.name} copy`,
    isDefault: false,
    design: existing.design,
    originalFilename: existing.originalFilename,
    originalMimeType: existing.originalMimeType,
    source: 'duplicated',
    applyBusinessDefaults: false,
  });
}

export const INVOICE_TEMPLATE_BINDINGS_KEY = 'invoice_template_bindings_v1';

type BindingStore = {
  version: 1;
  byInvoiceId: Record<string, string>;
};

async function readBindings(db: AppDatabase): Promise<BindingStore> {
  const raw = await db.getPreference(INVOICE_TEMPLATE_BINDINGS_KEY);
  if (!raw || typeof raw !== 'object') return { version: 1, byInvoiceId: {} };
  const byInvoiceId =
    typeof (raw as BindingStore).byInvoiceId === 'object' && (raw as BindingStore).byInvoiceId
      ? (raw as BindingStore).byInvoiceId
      : {};
  return { version: 1, byInvoiceId: { ...byInvoiceId } };
}

export async function getInvoiceTemplateBinding(
  db: AppDatabase,
  invoiceId: string,
): Promise<string | null> {
  const store = await readBindings(db);
  return store.byInvoiceId[invoiceId] || null;
}

export async function setInvoiceTemplateBinding(
  db: AppDatabase,
  invoiceId: string,
  templateId: string | null,
): Promise<void> {
  const store = await readBindings(db);
  if (!templateId) {
    delete store.byInvoiceId[invoiceId];
  } else {
    store.byInvoiceId[invoiceId] = templateId;
  }
  await db.upsertPreference(INVOICE_TEMPLATE_BINDINGS_KEY, store);
}

/** Resolve template for PDF: invoice binding first, then workspace default. */
export async function resolveInvoiceTemplateForPdf(
  db: AppDatabase,
  invoiceId: string,
): Promise<InvoiceTemplate | null> {
  const boundId = await getInvoiceTemplateBinding(db, invoiceId);
  if (boundId) {
    const bound = await getInvoiceTemplateById(db, boundId);
    if (bound) return bound;
  }
  return getDefaultInvoiceTemplate(db);
}
