import type PDFDocument from 'pdfkit';

import type { BrandingProfile, LineItemInput } from '../types/entities.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

/** Printable page margin on all sides (points). */
export const PDF_PAGE_MARGIN = 48;

/** Minimum gap between the content block and the payment section. */
export const PDF_PAYMENT_SECTION_GAP = 18;

/** Supported export / print page sizes. */
export type InvoicePdfPageSize = 'A4' | 'LETTER';

export type InvoicePdfBankDetails = {
  bankName?: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
};

export function pageContentWidth(doc: PdfDoc): number {
  return doc.page.width - PDF_PAGE_MARGIN * 2;
}

export function pageContentRight(doc: PdfDoc): number {
  return doc.page.width - PDF_PAGE_MARGIN;
}

/** Lowest Y content may use (standard bottom margin; no reserved branding footer band). */
export function contentBottomLimit(doc: PdfDoc): number {
  return doc.page.height - PDF_PAGE_MARGIN;
}

/** Ensure the cursor stays within the printable area (adds a page if needed). */
export function ensureContentFitsPage(doc: PdfDoc, neededHeight = 0): void {
  const limit = contentBottomLimit(doc) - 8;
  if (doc.y + neededHeight > limit) {
    doc.addPage();
  }
}

export function formatMoney(amount: number): string {
  return Number(amount || 0).toFixed(2);
}

/**
 * Presentation-only line number from the visible row order.
 * Never use this as a persistence key, React key, or API identifier.
 */
export function displayLineNumber(visibleRowIndex: number): number {
  return Math.max(0, Number(visibleRowIndex) || 0) + 1;
}

/** Subtle singular/plural line-count label for editor/PDF summaries. */
export function formatLineItemCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? '1 line item' : `${n} line items`;
}

/**
 * @deprecated GST registration labels are no longer printed on invoice PDFs.
 * Kept only so older imports fail closed to an empty string.
 */
export function gstStatusLabel(_lineItems: LineItemInput[]): string {
  return '';
}

/** Format ISO `YYYY-MM-DD` (or Date) as Australian `DD/MM/YYYY`. */
export function formatAustralianDate(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    return `${dmy[1].padStart(2, '0')}/${dmy[2].padStart(2, '0')}/${dmy[3]}`;
  }
  return trimmed;
}

/**
 * Format Australian mobile / landline numbers for PDF display.
 * Examples: +61410760760 → +61 410 760 760; 0410760760 → +61 410 760 760
 */
export function formatAustralianPhone(value: string | null | undefined): string {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  const onlyDigits = digits.replace(/\D/g, '');

  // +61 / 61 mobile (4xxxxxxxx) or national 04xxxxxxxx
  let nationalMobile: string | null = null;
  if (onlyDigits.startsWith('61') && onlyDigits.length === 11 && onlyDigits[2] === '4') {
    nationalMobile = onlyDigits.slice(2);
  } else if (onlyDigits.startsWith('0') && onlyDigits.length === 10 && onlyDigits[1] === '4') {
    nationalMobile = onlyDigits.slice(1);
  } else if (onlyDigits.length === 9 && onlyDigits[0] === '4') {
    nationalMobile = onlyDigits;
  }

  if (nationalMobile) {
    return `+61 ${nationalMobile.slice(0, 3)} ${nationalMobile.slice(3, 6)} ${nationalMobile.slice(6)}`;
  }

  // +61 landline: +61 X XXXX XXXX (area code + 8 digits after 61)
  if (onlyDigits.startsWith('61') && onlyDigits.length === 11) {
    const rest = onlyDigits.slice(2);
    return `+61 ${rest.slice(0, 1)} ${rest.slice(1, 5)} ${rest.slice(5)}`;
  }
  if (onlyDigits.startsWith('0') && onlyDigits.length === 10) {
    return `${onlyDigits.slice(0, 2)} ${onlyDigits.slice(2, 6)} ${onlyDigits.slice(6)}`;
  }

  return raw;
}

/** Format an 11-digit ABN as `XX XXX XXX XXX`. */
export function formatAustralianAbn(value: string | null | undefined): string {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11) return String(value).trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

/**
 * Keep legal suffixes with the preceding word so PDFKit does not orphan
 * "PTY LTD" on its own line when the name wraps.
 */
export function prepareBusinessNameForPdf(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  return trimmed.replace(
    /\s+(PTY\.?\s*LTD\.?|PTY\.?|LIMITED|LTD\.?)\s*$/i,
    (match) => match.replace(/\s+/g, '\u00A0'),
  );
}

export function formatInvoiceNumberForPdf(
  invoiceNumber: string | null | undefined,
): { statusLine: string | null; invoiceNumberLine: string } {
  const assigned = invoiceNumber != null && String(invoiceNumber).trim().length > 0
    ? String(invoiceNumber).trim()
    : null;
  if (assigned) {
    return {
      statusLine: null,
      invoiceNumberLine: `Invoice Number: ${assigned}`,
    };
  }
  return {
    statusLine: 'Status: Draft',
    invoiceNumberLine: 'Invoice Number: Not assigned',
  };
}

/**
 * Label + amount rows with decimal-aligned amounts (right column).
 */
export function drawAlignedTotals(
  doc: PdfDoc,
  rows: Array<{ label: string; amount: number; emphasis?: boolean }>,
  brandPrimary: string,
): void {
  const right = pageContentRight(doc);
  const amountWidth = 88;
  const labelWidth = 96;
  const amountX = right - amountWidth;
  const labelX = amountX - labelWidth - 8;
  const ruleX = labelX;
  let y = doc.y;

  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(ruleX, y)
    .lineTo(right, y)
    .stroke();
  y += 10;

  for (const row of rows) {
    const fontSize = row.emphasis ? 12 : 10;
    const color = row.emphasis ? brandPrimary : '#111827';
    doc.font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(color);
    doc.text(row.label, labelX, y, { width: labelWidth, align: 'left', lineBreak: false });
    doc.text(formatMoney(row.amount), amountX, y, {
      width: amountWidth,
      align: 'right',
      lineBreak: false,
    });
    y += fontSize + 6;
  }

  doc.x = PDF_PAGE_MARGIN;
  doc.y = y;
  doc.font('Helvetica');
}

export function drawPaymentDetailsBlock(
  doc: PdfDoc,
  profile: BrandingProfile | null,
  bankDetails?: InvoicePdfBankDetails | null,
): void {
  ensureContentFitsPage(doc, 80);
  doc.moveDown(PDF_PAYMENT_SECTION_GAP / 14);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text('Payment details', PDF_PAGE_MARGIN, doc.y, {
      width: pageContentWidth(doc),
      align: 'left',
    });

  const lines: string[] = [];
  if (profile?.companyName?.trim()) {
    lines.push(`Pay to: ${profile.companyName.trim()}`);
  }
  if (profile?.abnTaxId?.trim()) {
    lines.push(`ABN: ${formatAustralianAbn(profile.abnTaxId)}`);
  }
  if (profile?.email?.trim()) {
    // Email addresses must never be labelled "Accounts".
    lines.push(`Email: ${profile.email.trim()}`);
  }
  if (profile?.phone?.trim()) {
    lines.push(`Phone: ${formatAustralianPhone(profile.phone)}`);
  }

  const bankName = bankDetails?.bankName?.trim();
  const bsb = bankDetails?.bsb?.trim();
  const accountNumber = bankDetails?.accountNumber?.trim();
  const accountName = bankDetails?.accountName?.trim();
  const hasBank = Boolean(bankName || bsb || accountNumber || accountName);

  doc.moveDown(0.45);
  doc.font('Helvetica').fontSize(10).fillColor('#4b5563');

  if (lines.length === 0 && !hasBank) {
    doc.text('Configure business contact details in Aleya Settings.', PDF_PAGE_MARGIN, doc.y, {
      width: pageContentWidth(doc),
      align: 'left',
      lineGap: 3,
    });
    return;
  }

  if (lines.length) {
    doc.text(lines.join('\n'), PDF_PAGE_MARGIN, doc.y, {
      width: pageContentWidth(doc),
      align: 'left',
      lineGap: 3,
    });
  }

  if (hasBank) {
    doc.moveDown(0.7);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Bank transfer', {
      width: pageContentWidth(doc),
      align: 'left',
    });
    doc.moveDown(0.25);
    const bankLines = [
      bankName ? `Bank: ${bankName}` : null,
      bsb ? `BSB: ${bsb}` : null,
      accountNumber ? `Account Number: ${accountNumber}` : null,
      accountName ? `Account Name: ${accountName}` : null,
    ].filter((line): line is string => Boolean(line));
    doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(bankLines.join('\n'), {
      width: pageContentWidth(doc),
      align: 'left',
      lineGap: 3,
    });
  }
}
