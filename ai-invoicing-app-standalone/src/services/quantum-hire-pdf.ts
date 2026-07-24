import type PDFDocument from 'pdfkit';

import type { BrandingProfile, Customer, InvoiceDraft, LineItemInput } from '../types/entities.js';
import type { InvoiceTemplateDesign } from '../domain/templates/invoice-template-design.js';
import {
  readQuantumHireLogoBytes,
  readQuantumHireThankYouBytes,
} from '../domain/templates/cart-n-tip-reference.js';
import {
  formatAustralianAbn,
  formatAustralianDate,
  type InvoicePdfBankDetails,
} from './invoice-pdf-layout.js';
import { QH, quantumHireColumnBounds } from './quantum-hire-layout.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

const TEXT = '#111111';
const RULE = QH.table.ruleColor;
const GRID = QH.table.gridColor;

/**
 * PDFKit positions text by baseline. MuPDF / ReportLab geometry uses glyph-box top.
 * Empirically Helvetica* in PDFKit maps top → baseline with ~0.35×fontSize.
 */
function textTop(
  doc: PdfDoc,
  value: string,
  x: number,
  top: number,
  options: PDFKit.Mixins.TextOptions & { fontSize?: number } = {},
): void {
  const fontSize = options.fontSize ?? (doc as unknown as { _fontSize: number })._fontSize ?? 12;
  const baseline = top + fontSize * 0.35;
  const { fontSize: _ignored, ...rest } = options;
  doc.text(value, x, baseline, { ...rest, lineBreak: rest.lineBreak ?? false });
}

function moneyAud(amount: number): string {
  return `$${Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(quantity: number): string {
  if (!Number.isFinite(quantity)) return '0';
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

function formatMobile(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.startsWith('61')
    ? `0${digits.slice(2)}`
    : digits.startsWith('0')
      ? digits
      : digits.length === 9
        ? `0${digits}`
        : digits;
  if (national.length === 10) {
    return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
  }
  return phone.trim();
}

/** Pull leading DD/MM/YYYY from description when present (labour-date convention). */
export function splitLineDateAndDescription(description: string): {
  dateLabel: string | null;
  description: string;
} {
  const trimmed = String(description || '').trim();
  const match = trimmed.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/);
  if (match?.[1] && match[2]) {
    return { dateLabel: match[1], description: match[2].trim() };
  }
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (iso?.[1] && iso[2]) {
    return { dateLabel: formatAustralianDate(iso[1]), description: iso[2].trim() };
  }
  return { dateLabel: null, description: trimmed };
}

function paymentReferenceFor(invoiceNumber: string | null | undefined): string {
  const raw = String(invoiceNumber || '')
    .trim()
    .replace(/^#/, '');
  if (!raw) return '';
  if (/^inv/i.test(raw)) return raw;
  return `INV-${raw}`;
}

function invoiceNumberDisplay(invoiceNumber: string | null | undefined): string {
  const raw = String(invoiceNumber || '').trim();
  if (!raw) return 'Draft';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

function drawMetaRow(doc: PdfDoc, label: string, value: string, top: number): void {
  const { labelX, valueRight, width, labelSize, valueSize } = QH.meta;
  doc.font('Helvetica-Bold').fontSize(labelSize).fillColor(TEXT);
  textTop(doc, label, labelX, top, { fontSize: labelSize, width: width * 0.55 });
  const valueWidth = 90;
  doc.font('Helvetica').fontSize(valueSize);
  textTop(doc, value, valueRight - valueWidth, top, {
    fontSize: valueSize,
    width: valueWidth,
    align: 'right',
  });
}

function drawHeader(doc: PdfDoc, invoice: InvoiceDraft, design: InvoiceTemplateDesign): void {
  const logoBytes = readQuantumHireLogoBytes();
  if (logoBytes && design.layout.logoPosition !== 'none') {
    doc.image(logoBytes, QH.logo.x, QH.logo.y, {
      width: QH.logo.width,
      height: QH.logo.height,
      fit: [QH.logo.width, QH.logo.height],
    });
  }

  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(QH.headerDivider.x, QH.headerDivider.y0)
    .lineTo(QH.headerDivider.x, QH.headerDivider.y1)
    .stroke();

  doc.font('Helvetica-Bold').fontSize(QH.title.size).fillColor(TEXT);
  textTop(doc, design.documentTitle || 'TAX INVOICE', QH.title.x, QH.title.y, {
    fontSize: QH.title.size,
  });

  let metaY = QH.meta.firstY;
  drawMetaRow(doc, 'INVOICE NUMBER:', invoiceNumberDisplay(invoice.invoiceNumber), metaY);
  metaY += QH.meta.rowStep;
  drawMetaRow(doc, 'INVOICE DATE:', formatAustralianDate(invoice.issueDate), metaY);
  metaY += QH.meta.rowStep;
  drawMetaRow(doc, 'DUE DATE:', formatAustralianDate(invoice.dueDate), metaY);
  metaY += QH.meta.rowStep;
  const terms = (invoice.paymentTerms?.trim() || design.termsAndConditions?.trim() || '').trim();
  if (terms) {
    drawMetaRow(doc, 'TERMS:', terms.split('\n')[0] || terms, metaY);
  }

  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(QH.headerRule.x0, QH.headerRule.y)
    .lineTo(QH.headerRule.x1, QH.headerRule.y)
    .stroke();
}

function drawParties(
  doc: PdfDoc,
  customer: Customer,
  profile: BrandingProfile | null,
  design: InvoiceTemplateDesign,
): number {
  doc.font('Helvetica-Bold').fontSize(QH.billTo.labelSize).fillColor(TEXT);
  textTop(doc, 'BILL TO:', QH.billTo.x, QH.billTo.y, { fontSize: QH.billTo.labelSize });
  textTop(doc, 'FROM:', QH.from.x, QH.from.y, { fontSize: QH.from.labelSize });

  const billWidth = QH.from.x - QH.billTo.x - 16;
  doc.font('Helvetica-Bold').fontSize(QH.partyName.size);
  textTop(doc, customer.displayName || 'Customer', QH.billTo.x, QH.partyName.y, {
    fontSize: QH.partyName.size,
    width: billWidth,
    lineBreak: true,
  });

  const fromName =
    profile?.companyName?.trim() ||
    design.businessDefaults.companyName ||
    'Business Name';
  textTop(doc, fromName, QH.from.x, QH.partyName.y, {
    fontSize: QH.partyName.size,
    width: 260,
    lineBreak: true,
  });

  let leftY = QH.partyName.y + 22;
  doc.font('Helvetica').fontSize(QH.fromDetail.size).fillColor(TEXT);
  if (customer.address?.trim()) {
    textTop(doc, customer.address.trim(), QH.billTo.x, leftY, {
      fontSize: QH.fromDetail.size,
      width: billWidth,
      lineBreak: true,
    });
    leftY = doc.y + 4;
  }
  if (customer.email?.trim()) {
    textTop(doc, customer.email.trim(), QH.billTo.x, leftY, {
      fontSize: QH.fromDetail.size,
      width: billWidth,
      lineBreak: true,
    });
    leftY = doc.y + 4;
  }
  if (customer.phone?.trim()) {
    textTop(doc, customer.phone.trim(), QH.billTo.x, leftY, {
      fontSize: QH.fromDetail.size,
      width: billWidth,
      lineBreak: true,
    });
    leftY = doc.y + 4;
  }

  const phone = profile?.phone?.trim() || design.businessDefaults.phone?.trim() || null;
  const email = profile?.email?.trim() || design.businessDefaults.email?.trim() || null;
  const abn = profile?.abnTaxId?.trim() || design.businessDefaults.abnTaxId?.trim() || null;
  let rightY = QH.fromDetail.firstY;
  doc.font('Helvetica').fontSize(QH.fromDetail.size).fillColor(TEXT);
  if (phone) {
    textTop(doc, `M: ${formatMobile(phone)}`, QH.from.x, rightY, { fontSize: QH.fromDetail.size });
    rightY += QH.fromDetail.step;
  }
  if (email) {
    textTop(doc, `E: ${email}`, QH.from.x, rightY, { fontSize: QH.fromDetail.size });
    rightY += QH.fromDetail.step;
  }
  if (abn) {
    textTop(doc, `ABN: ${formatAustralianAbn(abn)}`, QH.from.x, rightY, {
      fontSize: QH.fromDetail.size,
    });
    rightY += QH.fromDetail.step;
  }

  return Math.max(leftY, rightY);
}

function drawTableHeader(doc: PdfDoc, y: number): number {
  const { outerLeft, outerRight, headerHeight, headerFontSize, headerTextYOffset, textX } = QH.table;
  const width = outerRight - outerLeft;
  doc.rect(outerLeft, y, width, headerHeight).fill('#000000');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(headerFontSize);
  const ty = y + headerTextYOffset;
  textTop(doc, 'DATE', textX.date, ty, { fontSize: headerFontSize });
  textTop(doc, 'DESCRIPTION', textX.description, ty, { fontSize: headerFontSize });
  textTop(doc, 'QTY', textX.qty, ty, { fontSize: headerFontSize });
  textTop(doc, 'RATE', textX.rate, ty, { fontSize: headerFontSize });
  textTop(doc, 'AMOUNT (EX GST)', textX.amount, ty, { fontSize: headerFontSize });
  return y + headerHeight;
}

function drawRowChrome(doc: PdfDoc, y0: number, y1: number): void {
  const { outerLeft, outerRight, colLines } = QH.table;
  doc.strokeColor(GRID).lineWidth(1);
  doc.moveTo(outerLeft, y1).lineTo(outerRight, y1).stroke();
  for (const x of colLines) {
    doc.moveTo(x, y0).lineTo(x, y1).stroke();
  }
  doc.moveTo(outerLeft, y0).lineTo(outerLeft, y1).stroke();
  doc.moveTo(outerRight, y0).lineTo(outerRight, y1).stroke();
}

function measureRowHeight(doc: PdfDoc, description: string): number {
  const cols = quantumHireColumnBounds();
  const descWidth = cols.description.width - 16;
  doc.font('Helvetica').fontSize(QH.table.bodyFontSize);
  const h = doc.heightOfString(description, { width: descWidth, lineGap: 1 });
  return Math.max(QH.table.rowHeight, Math.ceil(h + 12));
}

function drawTableRow(
  doc: PdfDoc,
  y: number,
  row: { dateLabel: string; description: string; quantity: number; unitPrice: number },
  rowHeight: number,
): number {
  const y1 = y + rowHeight;
  drawRowChrome(doc, y, y1);
  const { textX, bodyFontSize, bodyTextYOffset } = QH.table;
  const ty = y + bodyTextYOffset;
  const cols = quantumHireColumnBounds();
  doc.fillColor(TEXT).font('Helvetica').fontSize(bodyFontSize);
  textTop(doc, row.dateLabel, textX.date, ty, {
    fontSize: bodyFontSize,
    width: cols.date.width - 16,
  });
  textTop(doc, row.description, textX.description, ty, {
    fontSize: bodyFontSize,
    width: cols.description.width - 16,
    lineBreak: true,
  });
  textTop(doc, formatQty(row.quantity), textX.qty, ty, { fontSize: bodyFontSize });
  textTop(doc, moneyAud(row.unitPrice), textX.rate, ty, { fontSize: bodyFontSize });
  textTop(doc, moneyAud(row.quantity * row.unitPrice), textX.amount, ty, {
    fontSize: bodyFontSize,
  });
  return y1;
}

function drawFooter(
  doc: PdfDoc,
  invoice: InvoiceDraft,
  design: InvoiceTemplateDesign,
  bankDetails: InvoicePdfBankDetails | null | undefined,
  profile: BrandingProfile | null,
  tableBottom: number,
): void {
  const f = QH.footer;
  const ruleY = tableBottom + f.ruleYGap;
  doc.strokeColor(RULE).lineWidth(1).moveTo(QH.left, ruleY).lineTo(f.ruleX1, ruleY).stroke();

  const dividerTop = ruleY + f.dividerTopGap;
  const dividerBottom = dividerTop + f.dividerHeight;
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(f.dividerX, dividerTop)
    .lineTo(f.dividerX, dividerBottom)
    .stroke();

  const paymentY = ruleY + f.paymentTitleYGap;
  doc.font('Helvetica-Bold').fontSize(f.paymentTitleSize).fillColor(TEXT);
  textTop(doc, 'PAYMENT DETAILS:', QH.left, paymentY, { fontSize: f.paymentTitleSize });

  const bank = bankDetails || design.bankDetails;
  const rows: Array<[string, string]> = [
    ['Account Name:', bank?.accountName?.trim() || profile?.companyName?.trim() || ''],
    ['BSB:', bank?.bsb?.trim() || ''],
    ['Account Number:', bank?.accountNumber?.trim() || ''],
    ['Reference:', paymentReferenceFor(invoice.invoiceNumber)],
  ];
  let py = paymentY + 32;
  for (const [label, value] of rows) {
    if (!value) continue;
    doc.font('Helvetica-Bold').fontSize(f.paymentLabelSize).fillColor(TEXT);
    textTop(doc, label, QH.left, py, { fontSize: f.paymentLabelSize });
    doc.font('Helvetica').fontSize(f.paymentValueSize);
    textTop(doc, value, f.paymentValueX, py, { fontSize: f.paymentValueSize });
    py += f.paymentRowStep;
  }

  const notes = (invoice.notes?.trim() || design.notesPlaceholder?.trim() || '').trim();
  if (notes) {
    py += 10;
    doc.font('Helvetica-Bold').fontSize(f.noteTitleSize).fillColor(TEXT);
    textTop(doc, 'PLEASE NOTE:', QH.left, py, { fontSize: f.noteTitleSize });
    py += 19;
    doc.font('Helvetica').fontSize(f.noteBodySize).fillColor(TEXT);
    for (const line of notes.split('\n')) {
      textTop(doc, line, QH.left, py, {
        fontSize: f.noteBodySize,
        width: f.dividerX - QH.left - 12,
      });
      py += f.noteLineGap;
    }
  }

  let ty = paymentY + 1.4;
  doc.font('Helvetica-Bold').fontSize(f.totalsLabelSize).fillColor(TEXT);
  textTop(doc, 'SUBTOTAL (EX GST):', f.totalsX, ty, { fontSize: f.totalsLabelSize });
  textTop(doc, moneyAud(invoice.totals.subtotal), f.totalsX, ty, {
    fontSize: f.totalsLabelSize,
    width: f.totalsValueRight - f.totalsX,
    align: 'right',
  });

  ty += f.totalsRowStep;
  textTop(doc, 'GST (10%):', f.totalsX, ty, { fontSize: f.totalsLabelSize });
  textTop(doc, moneyAud(invoice.totals.gstTotal), f.totalsX, ty, {
    fontSize: f.totalsLabelSize,
    width: f.totalsValueRight - f.totalsX,
    align: 'right',
  });

  const ruleAfterGst = ty + 20;
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(f.totalRuleX0, ruleAfterGst)
    .lineTo(f.totalRuleX1, ruleAfterGst)
    .stroke();

  const totalY = ruleAfterGst + 12;
  doc.font('Helvetica-Bold').fontSize(f.totalLabelSize);
  textTop(doc, 'TOTAL (INC GST):', f.totalsX, totalY + 3, { fontSize: f.totalLabelSize });
  doc.font('Helvetica-Bold').fontSize(f.totalAmountSize);
  textTop(doc, moneyAud(invoice.totals.total), f.totalsX, totalY, {
    fontSize: f.totalAmountSize,
    width: f.totalsValueRight - f.totalsX,
    align: 'right',
  });

  const thankYou = readQuantumHireThankYouBytes();
  const thankYouY = dividerTop + f.thankYou.yOffsetFromDividerTop;
  if (thankYou) {
    doc.image(thankYou, f.thankYou.x, thankYouY, {
      width: f.thankYou.width,
      height: f.thankYou.height,
      fit: [f.thankYou.width, f.thankYou.height],
    });
  }
}

/**
 * Dedicated Cart N Tip #107 / Quantum Hire invoice renderer.
 * Coordinate-driven from measured reference geometry — not the Aleya invoice layout.
 * Customer, lines, dates and totals always come from live invoice data.
 */
export function renderQuantumHireInvoice(input: {
  doc: PdfDoc;
  invoice: InvoiceDraft;
  lineItems: LineItemInput[];
  customer: Customer;
  businessProfile: BrandingProfile | null;
  design: InvoiceTemplateDesign;
  bankDetails?: InvoicePdfBankDetails | null;
}): void {
  const { doc, invoice, lineItems, customer, businessProfile: profile, design } = input;

  drawHeader(doc, invoice, design);
  const partiesBottom = drawParties(doc, customer, profile, design);

  const prepared = lineItems.map((item) => {
    const split = splitLineDateAndDescription(item.description);
    return {
      dateLabel: split.dateLabel || formatAustralianDate(invoice.issueDate),
      description: split.description || '—',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      rowHeight: measureRowHeight(doc, split.description || '—'),
    };
  });

  // Keep the reference's large whitespace above the table when the party block is short.
  let tableTop = Math.max(QH.table.top, partiesBottom + 28);
  // Footer block on the reference occupies ~195pt below the table rule.
  const footerHeight = 195;
  const pageBottom = doc.page.height - 8;

  let y = drawTableHeader(doc, tableTop);

  for (let index = 0; index < prepared.length; index += 1) {
    const row = prepared[index]!;
    const afterRow = y + row.rowHeight;
    const isLast = index === prepared.length - 1;
    const needAfter = isLast ? footerHeight : QH.table.rowHeight + footerHeight;
    if (afterRow + needAfter > pageBottom && y > tableTop + QH.table.headerHeight) {
      doc.addPage();
      tableTop = 36;
      y = drawTableHeader(doc, tableTop);
    }
    y = drawTableRow(doc, y, row, row.rowHeight);
  }

  // Outer table border
  doc
    .strokeColor(GRID)
    .lineWidth(1)
    .rect(QH.table.outerLeft, tableTop, QH.contentWidth, y - tableTop)
    .stroke();

  if (y + footerHeight > pageBottom) {
    doc.addPage();
    y = 36;
  }

  drawFooter(doc, invoice, design, input.bankDetails, profile, y);
  doc.x = QH.left;
  doc.y = pageBottom - 8;
}
