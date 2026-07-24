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
  pageContentRight,
  pageContentWidth,
  type InvoicePdfBankDetails,
} from './invoice-pdf-layout.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

const NAVY = '#00162b';

function moneyAud(amount: number): string {
  return `$${Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pull leading DD/MM/YYYY from description when present (Cart N Tip labour rows). */
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

function drawMetaRow(
  doc: PdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): number {
  const labelWidth = width * 0.55;
  const valueWidth = width * 0.45;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111').text(label, x, y, {
    width: labelWidth,
    align: 'left',
    lineBreak: false,
  });
  doc.font('Helvetica').fontSize(9).fillColor('#111111').text(value, x + labelWidth, y, {
    width: valueWidth,
    align: 'right',
    lineBreak: false,
  });
  return y + 14;
}

/**
 * PDF layout matching the supplied Cart N Tip #107 / Quantum Hire invoice.
 * Built from editable fields + branding assets — not a screenshot background.
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
  const margin = design.layout.margins.left;
  const right = pageContentRight(doc);
  const width = pageContentWidth(doc);
  const navy = design.colors.primary || NAVY;
  const text = design.colors.text || '#111111';
  const border = design.colors.border || '#c5c9d0';
  const top = design.layout.margins.top;

  // —— Header: logo left + TAX INVOICE / meta right ——
  const logoBytes = readQuantumHireLogoBytes();
  let headerBottom = top;
  if (logoBytes && design.layout.logoPosition !== 'none') {
    const logoW = 118;
    const logoH = 82;
    doc.image(logoBytes, margin, top, { width: logoW, height: logoH, fit: [logoW, logoH] });
    headerBottom = Math.max(headerBottom, top + logoH);
  } else {
    doc
      .fillColor(navy)
      .font('Times-Bold')
      .fontSize(28)
      .text('QH', margin, top, { width: 110, align: 'left' });
    doc
      .font('Times-Bold')
      .fontSize(12)
      .text('QUANTUM', margin, top + 34, { width: 130, characterSpacing: 2 });
    doc.font('Helvetica').fontSize(8).text('HIRE SERVICES', margin, top + 50, { width: 130 });
    doc
      .font('Times-Italic')
      .fontSize(7)
      .fillColor('#5b7c99')
      .text('Labour Hire Solutions you can rely on', margin, top + 64, { width: 150 });
    headerBottom = top + 78;
  }

  const metaX = margin + width * 0.48;
  const metaWidth = width * 0.52;
  const dividerX = metaX - 10;
  doc
    .strokeColor(border)
    .lineWidth(0.8)
    .moveTo(dividerX, top + 4)
    .lineTo(dividerX, headerBottom - 4)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(design.typography.titleSize || 22)
    .fillColor(text)
    .text(design.documentTitle || 'TAX INVOICE', metaX, top + 2, {
      width: metaWidth,
      align: 'left',
    });

  let metaY = top + 32;
  const invoiceNo = invoice.invoiceNumber?.trim()
    ? invoice.invoiceNumber.trim().startsWith('#')
      ? invoice.invoiceNumber.trim()
      : `#${invoice.invoiceNumber.trim()}`
    : 'Draft';
  metaY = drawMetaRow(doc, 'INVOICE NUMBER:', invoiceNo, metaX, metaY, metaWidth);
  metaY = drawMetaRow(
    doc,
    'INVOICE DATE:',
    formatAustralianDate(invoice.issueDate),
    metaX,
    metaY,
    metaWidth,
  );
  metaY = drawMetaRow(
    doc,
    'DUE DATE:',
    formatAustralianDate(invoice.dueDate),
    metaX,
    metaY,
    metaWidth,
  );
  const terms =
    invoice.paymentTerms?.trim() ||
    design.termsAndConditions?.trim() ||
    '7 Days';
  metaY = drawMetaRow(doc, 'TERMS:', terms.split('\n')[0] || terms, metaX, metaY, metaWidth);
  headerBottom = Math.max(headerBottom, metaY + 8);

  // —— BILL TO / FROM ——
  let y = headerBottom + 18;
  const half = (width - 16) / 2;
  const billLabel = 'BILL TO:';
  doc.font('Helvetica-Bold').fontSize(9).fillColor(text).text(billLabel, margin, y, {
    width: half,
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(customer.displayName, margin, y + 14, { width: half });
  let leftY = y + 28;
  if (customer.address) {
    doc.font('Helvetica').fontSize(9).fillColor(text).text(customer.address, margin, leftY, {
      width: half,
    });
    leftY = doc.y + 2;
  }

  const fromX = margin + half + 16;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(text).text('FROM:', fromX, y, {
    width: half,
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(profile?.companyName || design.businessDefaults.companyName || 'Business Name', fromX, y + 14, {
      width: half,
    });
  let rightY = y + 28;
  const phone = profile?.phone || design.businessDefaults.phone;
  const email = profile?.email || design.businessDefaults.email;
  const abn = profile?.abnTaxId || design.businessDefaults.abnTaxId;
  doc.font('Helvetica').fontSize(9).fillColor(text);
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    let mobile = String(phone).trim();
    const national = digits.startsWith('61')
      ? `0${digits.slice(2)}`
      : digits.startsWith('0')
        ? digits
        : digits.length === 9
          ? `0${digits}`
          : digits;
    if (national.length === 10) {
      mobile = `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
    }
    doc.text(`M: ${mobile}`, fromX, rightY, { width: half });
    rightY += 12;
  }
  if (email) {
    doc.text(`E: ${email}`, fromX, rightY, { width: half });
    rightY += 12;
  }
  if (abn) {
    doc.text(`ABN: ${formatAustralianAbn(abn)}`, fromX, rightY, { width: half });
    rightY += 12;
  }
  y = Math.max(leftY, rightY) + 16;

  // —— Line table with black header ——
  const cols = {
    date: { x: margin, w: 72 },
    description: { x: margin + 72, w: 210 },
    qty: { x: margin + 282, w: 40 },
    rate: { x: margin + 322, w: 78 },
    amount: { x: margin + 400, w: Math.max(70, right - (margin + 400)) },
  };
  const headerH = 18;
  doc.rect(margin, y, width, headerH).fill('#000000');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  const hy = y + 5;
  doc.text('DATE', cols.date.x + 6, hy, { width: cols.date.w - 8 });
  doc.text('DESCRIPTION', cols.description.x + 4, hy, { width: cols.description.w - 8 });
  doc.text('QTY', cols.qty.x, hy, { width: cols.qty.w, align: 'center' });
  doc.text('RATE', cols.rate.x, hy, { width: cols.rate.w - 6, align: 'right' });
  doc.text('AMOUNT (EX GST)', cols.amount.x, hy, { width: cols.amount.w - 6, align: 'right' });
  y += headerH;

  for (const item of lineItems) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const split = splitLineDateAndDescription(item.description);
    const dateLabel = split.dateLabel || formatAustralianDate(invoice.issueDate);
    const lineSubtotal = item.quantity * item.unitPrice;
    const rowTop = y;
    const rowH = 20;
    doc
      .strokeColor(border)
      .lineWidth(0.6)
      .moveTo(margin, rowTop)
      .lineTo(right, rowTop)
      .stroke();

    // vertical rules
    for (const x of [cols.description.x, cols.qty.x, cols.rate.x, cols.amount.x]) {
      doc.moveTo(x, rowTop).lineTo(x, rowTop + rowH).stroke();
    }
    doc.moveTo(margin, rowTop).lineTo(margin, rowTop + rowH).stroke();
    doc.moveTo(right, rowTop).lineTo(right, rowTop + rowH).stroke();

    doc.fillColor(text).font('Helvetica').fontSize(9);
    doc.text(dateLabel, cols.date.x + 6, rowTop + 5, { width: cols.date.w - 8, lineBreak: false });
    doc.text(split.description, cols.description.x + 4, rowTop + 5, {
      width: cols.description.w - 8,
      lineBreak: false,
    });
    doc.text(String(item.quantity), cols.qty.x, rowTop + 5, {
      width: cols.qty.w,
      align: 'center',
      lineBreak: false,
    });
    doc.text(moneyAud(item.unitPrice), cols.rate.x, rowTop + 5, {
      width: cols.rate.w - 6,
      align: 'right',
      lineBreak: false,
    });
    doc.text(moneyAud(lineSubtotal), cols.amount.x, rowTop + 5, {
      width: cols.amount.w - 6,
      align: 'right',
      lineBreak: false,
    });
    y = rowTop + rowH;
  }
  doc
    .strokeColor(border)
    .lineWidth(0.6)
    .moveTo(margin, y)
    .lineTo(right, y)
    .stroke();

  // —— Footer: payment + notes left, totals right ——
  y += 22;
  if (y > doc.page.height - 160) {
    doc.addPage();
    y = design.layout.margins.top;
  }
  const footerTop = y;
  const leftW = width * 0.52;
  const rightW = width * 0.42;
  const rightColX = margin + width * 0.58;

  doc
    .strokeColor(border)
    .lineWidth(0.8)
    .moveTo(rightColX - 12, footerTop)
    .lineTo(rightColX - 12, footerTop + 120)
    .stroke();

  const paymentLabel = 'PAYMENT DETAILS:';
  doc.font('Helvetica-Bold').fontSize(9).fillColor(text).text(paymentLabel, margin, footerTop, {
    width: leftW,
  });
  let py = footerTop + 16;
  const bank = input.bankDetails || design.bankDetails;
  const paymentRows: Array<[string, string]> = [
    ['Account Name:', bank?.accountName || profile?.companyName || ''],
    ['BSB:', bank?.bsb || ''],
    ['Account Number:', bank?.accountNumber || ''],
    [
      'Reference:',
      invoice.invoiceNumber?.trim()
        ? `INV-${String(invoice.invoiceNumber).replace(/^#/, '')}`
        : 'INV-Draft',
    ],
  ];
  for (const [label, value] of paymentRows) {
    if (!value) continue;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(text).text(label, margin, py, {
      width: 100,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(9).text(value, margin + 100, py, {
      width: leftW - 100,
      align: 'left',
      lineBreak: false,
    });
    py += 13;
  }

  const notesLabel = 'PLEASE NOTE:';
  const notes =
    invoice.notes?.trim() ||
    design.notesPlaceholder ||
    'Payment is required within 7 days from the invoice date.\nThank you for your business.';
  py += 10;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(text).text(notesLabel, margin, py, {
    width: leftW,
  });
  py += 14;
  doc.font('Helvetica').fontSize(9).fillColor(text).text(notes, margin, py, {
    width: leftW,
    lineGap: 2,
  });
  const leftBottom = doc.y;

  let ty = footerTop;
  const totals: Array<{ label: string; amount: number; bold?: boolean; large?: boolean }> = [
    { label: 'SUBTOTAL (EX GST):', amount: invoice.totals.subtotal },
    { label: 'GST (10%):', amount: invoice.totals.gstTotal, bold: true },
    { label: 'TOTAL (INC GST):', amount: invoice.totals.total, bold: true, large: true },
  ];
  for (const row of totals) {
    const size = row.large ? 14 : 9;
    doc
      .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(text)
      .text(row.label, rightColX, ty, { width: rightW * 0.62, lineBreak: false });
    doc.text(moneyAud(row.amount), rightColX + rightW * 0.5, ty, {
      width: rightW * 0.5,
      align: 'right',
      lineBreak: false,
    });
    ty += size + 8;
    if (row.label.startsWith('GST')) {
      doc
        .strokeColor(border)
        .lineWidth(0.8)
        .moveTo(rightColX, ty - 2)
        .lineTo(right, ty - 2)
        .stroke();
      ty += 6;
    }
  }

  const thankYou = readQuantumHireThankYouBytes();
  if (thankYou) {
    doc.image(thankYou, rightColX + 20, Math.max(ty + 8, leftBottom - 40), {
      width: 120,
      height: 50,
      fit: [120, 50],
    });
  } else {
    doc
      .font('Times-Italic')
      .fontSize(18)
      .fillColor('#6b7280')
      .text('Thank you', rightColX, ty + 10, { width: rightW, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#6b7280')
      .text('FOR YOUR BUSINESS', rightColX, ty + 32, {
        width: rightW,
        align: 'center',
        characterSpacing: 1.5,
      });
  }

  doc.x = margin;
  doc.y = Math.max(leftBottom, ty + 60);
}
