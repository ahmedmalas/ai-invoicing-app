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

export function gstStatusLabel(lineItems: LineItemInput[]): string {
  const chargesGst = lineItems.some((item) => item.gstApplicable);
  return chargesGst ? 'GST registered - GST shown per line' : 'No GST charged on this invoice';
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
    lines.push(`ABN: ${profile.abnTaxId.trim()}`);
  }
  if (profile?.email?.trim()) {
    // Email addresses must never be labelled "Accounts".
    lines.push(`Email: ${profile.email.trim()}`);
  }
  if (profile?.phone?.trim()) {
    lines.push(`Phone: ${profile.phone.trim()}`);
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
