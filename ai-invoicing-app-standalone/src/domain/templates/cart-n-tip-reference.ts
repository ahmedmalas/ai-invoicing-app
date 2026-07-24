import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppDatabase } from '../../db/database.js';
import { defaultInvoiceTemplateDesign, type InvoiceTemplateDesign } from './invoice-template-design.js';
import { createInvoiceTemplate, listInvoiceTemplates } from './invoice-template-store.js';

const NAVY = '#00162b';
const MUTED = '#4b5563';
const BORDER = '#c5c9d0';

/** Editable design matching Cart N Tip #107 / Quantum Hire Services reference invoice. */
export function createCartNTipReferenceDesign(): InvoiceTemplateDesign {
  return defaultInvoiceTemplateDesign({
    documentTitle: 'TAX INVOICE',
    colors: {
      primary: NAVY,
      secondary: '#7eb6d9',
      accent: NAVY,
      text: '#111111',
      muted: MUTED,
      border: BORDER,
      background: '#ffffff',
    },
    typography: {
      headingFont: 'Helvetica-Bold',
      bodyFont: 'Helvetica',
      titleSize: 22,
      headingSize: 10,
      bodySize: 9,
    },
    layout: {
      margins: { top: 40, right: 42, bottom: 40, left: 42 },
      headerStyle: 'split-bill-from',
      logoPosition: 'left',
      layoutPreset: 'quantum-hire',
      sections: defaultInvoiceTemplateDesign().layout.sections.map((section) => {
        if (section.type === 'customer') return { ...section, label: 'BILL TO:' };
        if (section.type === 'payment') return { ...section, label: 'PAYMENT DETAILS:' };
        if (section.type === 'notes') return { ...section, label: 'PLEASE NOTE:' };
        if (section.type === 'terms') return { ...section, label: 'TERMS:' };
        return section;
      }),
      tableColumns: [
        { id: 'lineNumber', label: '#', visible: false },
        { id: 'date', label: 'DATE', visible: true },
        { id: 'description', label: 'DESCRIPTION', visible: true },
        { id: 'quantity', label: 'QTY', visible: true },
        { id: 'unitPrice', label: 'RATE', visible: true },
        { id: 'gst', label: 'GST', visible: false },
        { id: 'amount', label: 'AMOUNT (EX GST)', visible: true },
      ],
    },
    businessDefaults: {
      companyName: 'Quantum Hire Services Pty Ltd',
      legalName: 'Quantum Hire Services Pty Ltd',
      abnTaxId: '26641770130',
      address: null,
      email: 'info@quantumhireservices.com.au',
      phone: '0410760760',
      website: null,
    },
    bankDetails: {
      accountName: 'Quantum Hire Services Pty Ltd',
      bsb: '012347',
      accountNumber: '814027296',
      referenceLabel: 'Reference',
    },
    paymentDetails:
      'Account Name: Quantum Hire Services Pty Ltd\nBSB: 012347\nAccount Number: 814027296',
    termsAndConditions: '7 Days',
    notesPlaceholder:
      'Payment is required within 7 days from the invoice date.\nThank you for your business.',
    borders: { table: true, headerRule: true, width: 0.75 },
    analysisNotes: [
      'Seeded from supplied Cart N Tip #107 reference invoice.',
      'Recreated as editable Quantum Hire layout components — not a background image.',
    ],
  });
}

function brandingAsset(name: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'public', 'branding', name),
    join(process.cwd(), 'ai-invoicing-app-standalone', 'public', 'branding', name),
    join(here, '../../../public/branding', name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveQuantumHireLogoPath(): string | null {
  return brandingAsset('quantum-hire-logo.png');
}

export function resolveQuantumHireThankYouPath(): string | null {
  return brandingAsset('quantum-hire-thank-you.png');
}

export function readQuantumHireLogoBytes(): Buffer | null {
  const path = resolveQuantumHireLogoPath();
  return path ? readFileSync(path) : null;
}

export function readQuantumHireThankYouBytes(): Buffer | null {
  const path = resolveQuantumHireThankYouPath();
  return path ? readFileSync(path) : null;
}

/**
 * Ensure the supplied Cart N Tip reference exists as the workspace default template.
 * Idempotent unless `force` is set.
 */
export async function ensureCartNTipReferenceTemplate(
  db: AppDatabase,
  options: { force?: boolean } = {},
): Promise<{ installed: boolean; templateId?: string }> {
  const existing = await listInvoiceTemplates(db);
  const match = existing.find((item) => /cart\s*n\s*tip|quantum\s*hire/i.test(item.name));
  if (existing.length && !options.force) {
    if (match?.id) return { installed: false, templateId: match.id };
    const fallback = existing.find((i) => i.isDefault)?.id;
    if (fallback) return { installed: false, templateId: fallback };
    return { installed: false };
  }
  const template = await createInvoiceTemplate(db, {
    name: 'Cart N Tip #107 — Quantum Hire',
    isDefault: true,
    applyBusinessDefaults: true,
    source: 'imported',
    originalFilename: 'Cart_N_Tip_107.pdf',
    originalMimeType: 'application/pdf',
    design: createCartNTipReferenceDesign(),
  });
  return { installed: true, templateId: template.id };
}
