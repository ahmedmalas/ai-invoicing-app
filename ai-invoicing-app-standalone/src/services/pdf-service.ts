import PDFDocument from 'pdfkit';

import type {
  BrandingProfile,
  CustomerPayment,
  CreditNote,
  Customer,
  InvoiceDraft,
  LineItemInput,
  PurchaseOrder,
  PurchaseOrderLineItemInput,
  Supplier,
  SupplierBill,
  SupplierBillPayment,
  SupplierBillLineItemInput,
} from '../types/entities.js';
import type { CustomerStatementReport } from '../db/database.js';
import type { InvoiceTemplateDesign } from '../domain/templates/invoice-template-design.js';
import { renderQuantumHireInvoice } from './quantum-hire-pdf.js';
import {
  displayLineNumber,
  drawAlignedTotals,
  drawPaymentDetailsBlock,
  ensureContentFitsPage,
  formatAustralianAbn,
  formatAustralianDate,
  formatAustralianPhone,
  formatInvoiceNumberForPdf,
  formatLineItemCountLabel,
  pageContentRight,
  pageContentWidth,
  PDF_PAGE_MARGIN,
  prepareBusinessNameForPdf,
  type InvoicePdfBankDetails,
  type InvoicePdfPageSize,
} from './invoice-pdf-layout.js';
import { drawBusinessLogoMark } from './logo-pdf.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

function writeBrandedHeader(
  doc: PdfDoc,
  profile: BrandingProfile | null,
  brandPrimary: string,
  design?: InvoiceTemplateDesign | null,
): void {
  const logoPosition = design?.layout.logoPosition ?? 'left';
  const headingFont = design?.typography.headingFont ?? 'Helvetica-Bold';
  const titleSize = design?.typography.titleSize ?? 22;
  if (logoPosition === 'none') {
    const businessName = prepareBusinessNameForPdf(profile?.companyName ?? 'Business Name');
    doc
      .fillColor(brandPrimary)
      .fontSize(titleSize)
      .font(headingFont)
      .text(businessName, PDF_PAGE_MARGIN, PDF_PAGE_MARGIN, {
        width: pageContentWidth(doc),
        lineGap: 2,
      });
    doc.x = PDF_PAGE_MARGIN;
    doc.y = Math.max(doc.y, PDF_PAGE_MARGIN + 28) + 4;
    doc.font(design?.typography.bodyFont ?? 'Helvetica');
    return;
  }

  const logoHeight = drawBusinessLogoMark(doc, profile, PDF_PAGE_MARGIN, PDF_PAGE_MARGIN, 44);
  const textX = logoHeight > 0 ? PDF_PAGE_MARGIN + 56 : PDF_PAGE_MARGIN;
  const textY = logoHeight > 0 ? PDF_PAGE_MARGIN + 4 : PDF_PAGE_MARGIN;
  const nameWidth = Math.max(200, pageContentWidth(doc) - (textX - PDF_PAGE_MARGIN));
  const businessName = prepareBusinessNameForPdf(profile?.companyName ?? 'Business Name');
  doc
    .fillColor(brandPrimary)
    .fontSize(titleSize)
    .font(headingFont)
    .text(businessName, textX, textY, { width: nameWidth, lineGap: 2 });
  doc.x = PDF_PAGE_MARGIN;
  doc.y = Math.max(doc.y, PDF_PAGE_MARGIN + (logoHeight || 28)) + 4;
  doc.font(design?.typography.bodyFont ?? 'Helvetica');
}

function writeBusinessIdentityBlock(
  doc: PdfDoc,
  profile: BrandingProfile | null,
  design?: InvoiceTemplateDesign | null,
): void {
  const width = pageContentWidth(doc);
  const textColor = design?.colors.text ?? '#111827';
  const bodySize = design?.typography.bodySize ?? 11;
  doc.fillColor(textColor).fontSize(bodySize);
  doc.text(profile?.address?.trim() || 'Business address not set', PDF_PAGE_MARGIN, doc.y, {
    width,
    align: 'left',
    lineGap: 2,
  });
  if (profile?.abnTaxId?.trim()) {
    doc.text(`ABN: ${formatAustralianAbn(profile.abnTaxId)}`, { width, align: 'left' });
  }
  if (profile?.email?.trim()) {
    doc.text(`Email: ${profile.email.trim()}`, { width, align: 'left' });
  }
  if (profile?.phone?.trim()) {
    doc.text(`Phone: ${formatAustralianPhone(profile.phone)}`, { width, align: 'left' });
  }
}

function columnVisible(
  design: InvoiceTemplateDesign | null | undefined,
  id: string,
  fallback = true,
): boolean {
  const col = design?.layout.tableColumns?.find((item) => item.id === id);
  return col ? col.visible : fallback;
}

function columnLabel(
  design: InvoiceTemplateDesign | null | undefined,
  id: string,
  fallback: string,
): string {
  const col = design?.layout.tableColumns?.find((item) => item.id === id);
  return col?.label || fallback;
}

export function generateInvoicePdfBuffer(input: {
  invoice: InvoiceDraft;
  lineItems: LineItemInput[];
  customer: Customer;
  businessProfile: BrandingProfile | null;
  /** Optional bank transfer details for future profile wiring. */
  bankDetails?: InvoicePdfBankDetails | null;
  /** Editable template design recreated from an uploaded invoice. */
  templateDesign?: InvoiceTemplateDesign | null;
  /** Page size for export / print parity (default A4). */
  pageSize?: InvoicePdfPageSize;
  timeoutMs?: number;
}): Promise<Buffer> {
  const timeoutMs = Math.max(1_000, Math.trunc(input.timeoutMs ?? 20_000));
  const pageSize = input.pageSize ?? 'A4';
  const design = input.templateDesign || null;
  // Quantum Hire uses a dedicated near-bleed coordinate system (≈12pt edges).
  // Do not bootstrap that renderer with Aleya PDF_PAGE_MARGIN (48) or template guesses.
  const quantumHire = design?.layout.layoutPreset === 'quantum-hire';
  const margin = quantumHire ? 0 : (design?.layout.margins.left ?? PDF_PAGE_MARGIN);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: pageSize,
      margins: quantumHire
        ? { top: 0, left: 0, right: 0, bottom: 0 }
        : {
            top: design?.layout.margins.top ?? PDF_PAGE_MARGIN,
            left: margin,
            right: design?.layout.margins.right ?? PDF_PAGE_MARGIN,
            bottom: design?.layout.margins.bottom ?? PDF_PAGE_MARGIN,
          },
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        doc.destroy();
      } catch {
        /* ignore */
      }
      reject(Object.assign(new Error('PDF_GENERATION_TIMEOUT'), { code: 'PDF_GENERATION_TIMEOUT' }));
    }, timeoutMs);

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    const profile = input.businessProfile;
    const brandPrimary = design?.colors.primary ?? profile?.primaryColor ?? '#0f172a';
    const textColor = design?.colors.text ?? '#111827';
    const mutedColor = design?.colors.muted ?? '#6b7280';
    const borderColor = design?.colors.border ?? '#d1d5db';
    const bodyFont = design?.typography.bodyFont ?? 'Helvetica';
    const headingFont = design?.typography.headingFont ?? 'Helvetica-Bold';
    const bodySize = design?.typography.bodySize ?? 10;
    const headingSize = design?.typography.headingSize ?? 12;
    const contentRight = () => pageContentRight(doc);
    const contentWidth = () => pageContentWidth(doc);
    const invoiceMeta = formatInvoiceNumberForPdf(input.invoice.invoiceNumber);
    const documentTitle = design?.documentTitle || 'TAX INVOICE';
    const bankDetails =
      input.bankDetails ||
      (design?.bankDetails
        ? {
            accountName: design.bankDetails.accountName,
            bsb: design.bankDetails.bsb,
            accountNumber: design.bankDetails.accountNumber,
          }
        : null);

    if (design?.layout.layoutPreset === 'quantum-hire') {
      renderQuantumHireInvoice({
        doc,
        invoice: input.invoice,
        lineItems: input.lineItems,
        customer: input.customer,
        businessProfile: profile,
        design,
        bankDetails,
      });
      doc.end();
      return;
    }

    writeBrandedHeader(doc, profile, brandPrimary, design);
    writeBusinessIdentityBlock(doc, profile, design);

    doc.moveDown(1);
    doc.font(headingFont).fontSize(18).fillColor(textColor).text(documentTitle, {
      width: contentWidth(),
      align: design?.layout.headerStyle === 'stacked' ? 'left' : 'right',
    });
    doc.font(bodyFont).fontSize(bodySize + 1);
    if (invoiceMeta.statusLine) {
      doc.text(invoiceMeta.statusLine, {
        width: contentWidth(),
        align: 'right',
      });
    }
    doc.text(invoiceMeta.invoiceNumberLine, {
      width: contentWidth(),
      align: 'right',
    });
    doc.text(`Issue Date: ${formatAustralianDate(input.invoice.issueDate)}`, {
      width: contentWidth(),
      align: 'right',
    });
    doc.text(`Due Date: ${formatAustralianDate(input.invoice.dueDate)}`, {
      width: contentWidth(),
      align: 'right',
    });
    const invoiceTitle = String(input.invoice.title ?? '').trim();
    if (invoiceTitle) {
      doc.text(`Title: ${invoiceTitle}`, {
        width: contentWidth(),
        align: 'right',
      });
    }

    doc.moveDown(1);
    const billLabel =
      design?.layout.sections.find((section) => section.type === 'customer')?.label || 'Bill To';

    if (design?.layout.headerStyle === 'split-bill-from') {
      const half = contentWidth() / 2 - 8;
      const topY = doc.y;
      doc.font(headingFont).fontSize(headingSize).fillColor(textColor).text(billLabel, margin, topY, {
        width: half,
        align: 'left',
      });
      doc.font(bodyFont).fontSize(bodySize).text(input.customer.displayName, {
        width: half,
        align: 'left',
      });
      if (input.customer.address) doc.text(input.customer.address, { width: half, align: 'left' });
      if (input.customer.email) doc.text(input.customer.email, { width: half, align: 'left' });
      const leftBottom = doc.y;

      doc.font(headingFont).fontSize(headingSize).fillColor(textColor).text('From', margin + half + 16, topY, {
        width: half,
        align: 'left',
      });
      doc
        .font(bodyFont)
        .fontSize(bodySize)
        .text(profile?.companyName || 'Business Name', { width: half, align: 'left' });
      if (profile?.email) doc.text(profile.email, { width: half, align: 'left' });
      if (profile?.phone) doc.text(formatAustralianPhone(profile.phone), { width: half, align: 'left' });
      if (profile?.abnTaxId) {
        doc.text(`ABN: ${formatAustralianAbn(profile.abnTaxId)}`, { width: half, align: 'left' });
      }
      doc.y = Math.max(leftBottom, doc.y);
      doc.x = margin;
    } else {
      doc.font(headingFont).fontSize(headingSize).fillColor(textColor).text(billLabel, margin, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.font(bodyFont).fontSize(bodySize).text(input.customer.displayName, {
        width: contentWidth(),
        align: 'left',
      });
      if (input.customer.address) {
        doc.text(input.customer.address, { width: contentWidth(), align: 'left' });
      }
      if (input.customer.email) {
        doc.text(input.customer.email, { width: contentWidth(), align: 'left' });
      }
    }

    doc.moveDown(1);
    ensureContentFitsPage(doc, 40);
    const lineItemsHeadingY = doc.y;
    doc.font(headingFont).fontSize(headingSize).fillColor(textColor).text('Line Items', margin, lineItemsHeadingY, {
      width: contentWidth() - 120,
      align: 'left',
    });
    doc
      .font(bodyFont)
      .fontSize(9)
      .fillColor(mutedColor)
      .text(formatLineItemCountLabel(input.lineItems.length), margin, lineItemsHeadingY + 2, {
        width: contentWidth(),
        align: 'right',
      });
    doc.y = Math.max(doc.y, lineItemsHeadingY + 14);
    doc.moveDown(0.35);

    const showNumber = columnVisible(design, 'lineNumber', true);
    const showDate = columnVisible(design, 'date', false);
    const showGst = columnVisible(design, 'gst', true);

    const col = {
      number: { x: margin, width: showNumber ? 22 : 0 },
      date: { x: margin + (showNumber ? 28 : 0), width: showDate ? 62 : 0 },
      description: {
        x: margin + (showNumber ? 28 : 0) + (showDate ? 66 : 0),
        width: showDate ? 150 : 194,
      },
      qty: { x: margin + 230, width: 50 },
      unit: { x: margin + 285, width: 70 },
      gst: { x: margin + 360, width: showGst ? 55 : 0 },
      total: { x: contentRight() - 70, width: 70 },
    };

    const headerY = doc.y;
    doc.font(bodyFont).fontSize(bodySize).fillColor(mutedColor);
    if (showNumber) {
      doc.text(columnLabel(design, 'lineNumber', '#'), col.number.x, headerY, {
        width: col.number.width,
        align: 'right',
      });
    }
    if (showDate) {
      doc.text(columnLabel(design, 'date', 'Date'), col.date.x, headerY, {
        width: col.date.width,
      });
    }
    doc.text(columnLabel(design, 'description', 'Description'), col.description.x, headerY, {
      width: col.description.width,
    });
    doc.text(columnLabel(design, 'quantity', 'Qty'), col.qty.x, headerY, {
      width: col.qty.width,
      align: 'right',
    });
    doc.text(columnLabel(design, 'unitPrice', 'Unit'), col.unit.x, headerY, {
      width: col.unit.width,
      align: 'right',
    });
    if (showGst) {
      doc.text(columnLabel(design, 'gst', 'GST'), col.gst.x, headerY, {
        width: col.gst.width,
        align: 'right',
      });
    }
    doc.text(columnLabel(design, 'amount', 'Total'), col.total.x, headerY, {
      width: col.total.width,
      align: 'right',
    });

    doc.moveDown(0.4);
    if (design?.borders.headerRule !== false) {
      doc
        .strokeColor(borderColor)
        .lineWidth(design?.borders.width ?? 1)
        .moveTo(margin, doc.y)
        .lineTo(contentRight(), doc.y)
        .stroke();
    }

    input.lineItems.forEach((item, index) => {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineGst = item.gstApplicable ? lineSubtotal * 0.1 : 0;
      const lineTotal = showGst ? lineSubtotal + lineGst : lineSubtotal;
      const number = displayLineNumber(index);

      ensureContentFitsPage(doc, 28);
      doc.moveDown(0.55);
      const y = doc.y;
      if (showNumber) {
        doc.fillColor(mutedColor).fontSize(bodySize).text(String(number), col.number.x, y, {
          width: col.number.width,
          align: 'right',
        });
      }
      if (showDate) {
        doc
          .fillColor(textColor)
          .fontSize(bodySize)
          .text(formatAustralianDate(input.invoice.issueDate), col.date.x, y, {
            width: col.date.width,
          });
      }
      doc.fillColor(textColor).fontSize(bodySize).text(item.description, col.description.x, y, {
        width: col.description.width,
      });
      const rowBottom = doc.y;
      doc.text(item.quantity.toFixed(2), col.qty.x, y, { width: col.qty.width, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), col.unit.x, y, { width: col.unit.width, align: 'right' });
      if (showGst) {
        doc.text(lineGst.toFixed(2), col.gst.x, y, { width: col.gst.width, align: 'right' });
      }
      doc.text(lineTotal.toFixed(2), col.total.x, y, { width: col.total.width, align: 'right' });
      doc.y = Math.max(rowBottom, doc.y);
      doc.x = margin;
    });

    doc.moveDown(1);
    ensureContentFitsPage(doc, 70);
    drawAlignedTotals(
      doc,
      [
        { label: 'Subtotal', amount: input.invoice.totals.subtotal },
        { label: 'GST', amount: input.invoice.totals.gstTotal },
        { label: 'Total', amount: input.invoice.totals.total, emphasis: true },
      ],
      brandPrimary,
    );

    const notesText = input.invoice.notes || design?.notesPlaceholder || '';
    if (notesText) {
      ensureContentFitsPage(doc, 40);
      doc.moveDown(1.1);
      const notesLabel =
        design?.layout.sections.find((section) => section.type === 'notes')?.label || 'Notes';
      doc.font(headingFont).fillColor(textColor).fontSize(headingSize).text(notesLabel, margin, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.font(bodyFont).fontSize(bodySize).fillColor('#4b5563').text(notesText, {
        width: contentWidth(),
        align: 'left',
        lineGap: 3,
      });
    }

    const paymentTerms = input.invoice.paymentTerms || design?.termsAndConditions || '';
    if (paymentTerms) {
      ensureContentFitsPage(doc, 36);
      doc.moveDown(0.9);
      const termsLabel =
        design?.layout.sections.find((section) => section.type === 'terms')?.label ||
        'Payment terms';
      doc.font(headingFont).fillColor(textColor).fontSize(headingSize).text(termsLabel, margin, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.font(bodyFont).fontSize(bodySize).fillColor('#4b5563').text(paymentTerms, {
        width: contentWidth(),
        align: 'left',
        lineGap: 3,
      });
    }

    if (design?.paymentDetails && !bankDetails?.bsb) {
      ensureContentFitsPage(doc, 40);
      doc.moveDown(0.9);
      const paymentLabel =
        design.layout.sections.find((section) => section.type === 'payment')?.label ||
        'Payment details';
      doc.font(headingFont).fillColor(textColor).fontSize(headingSize).text(paymentLabel, margin, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.font(bodyFont).fontSize(bodySize).fillColor('#4b5563').text(design.paymentDetails, {
        width: contentWidth(),
        align: 'left',
        lineGap: 3,
      });
    }

    drawPaymentDetailsBlock(doc, profile, bankDetails);
    doc.end();
  });
}

export function generateCustomerStatementPdfBuffer(input: {
  statement: CustomerStatementReport;
  businessProfile: BrandingProfile | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';
    const statement = input.statement;

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(11).text('Customer Statement');
    doc.text(`Customer: ${statement.customer.displayName}`);
    doc.text(`Generated: ${statement.generatedAt}`);
    doc.text(`Period: ${statement.period.from ?? 'Beginning'} to ${statement.period.to ?? 'Now'}`);

    doc.moveDown(1);
    doc.fillColor('#111827').fontSize(12).text('Summary');
    doc.fontSize(11);
    doc.text(`Opening Balance: ${statement.openingBalance.toFixed(2)}`);
    doc.text(`Period Activity: ${statement.periodTotal.toFixed(2)}`);
    doc.text(`Closing Balance: ${statement.closingBalance.toFixed(2)}`);
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .fillColor('#4b5563')
      .text('Credits: omitted (not supported by current invoice architecture).');

    doc.moveDown(1);
    doc.fillColor('#111827').fontSize(12).text('Invoices');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Invoice #', 50, doc.y, { width: 110 });
    doc.text('Issue', 165, doc.y - 12, { width: 80 });
    doc.text('Due', 250, doc.y - 12, { width: 80 });
    doc.text('Title', 335, doc.y - 12, { width: 130 });
    doc.text('Total', 470, doc.y - 12, { width: 78, align: 'right' });

    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    if (statement.entries.length === 0) {
      doc.moveDown(0.8);
      doc.fillColor('#6b7280').text('No finalised invoices in selected period.');
    } else {
      for (const entry of statement.entries) {
        doc.moveDown(0.6);
        const y = doc.y;
        doc.fillColor('#111827').text(entry.invoiceNumber, 50, y, { width: 110 });
        doc.text(entry.issueDate, 165, y, { width: 80 });
        doc.text(entry.dueDate, 250, y, { width: 80 });
        doc.text(entry.title, 335, y, { width: 130 });
        doc.text(entry.total.toFixed(2), 470, y, { width: 78, align: 'right' });
      }
    }

    doc.end();
  });
}

export function generateCreditNotePdfBuffer(input: {
  creditNote: CreditNote;
  customer: Customer;
  businessProfile: BrandingProfile | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(16).text('Credit Note', { align: 'right' });
    doc.fontSize(11).text(`Credit Note #: ${input.creditNote.creditNoteNumber}`, { align: 'right' });
    doc.text(`Issue Date: ${input.creditNote.issueDate}`, { align: 'right' });
    doc.text(`Linked Invoice: ${input.creditNote.linkedInvoiceId}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Customer');
    doc.fontSize(11).text(input.customer.displayName);
    if (input.customer.address) {
      doc.text(input.customer.address);
    }
    if (input.customer.email) {
      doc.text(input.customer.email);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Reason');
    doc.fontSize(11).text(input.creditNote.reason);

    doc.moveDown(1);
    doc.fontSize(12).text('Credited Items');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Description', 50, doc.y, { width: 370 });
    doc.text('Amount', 430, doc.y - 12, { width: 118, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    for (const item of input.creditNote.lineItems) {
      doc.moveDown(0.6);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(item.description, 50, y, { width: 370 });
      doc.text(item.amount.toFixed(2), 430, y, { width: 118, align: 'right' });
    }

    doc.moveDown(1.2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(330, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown(0.5);
    doc
      .fontSize(13)
      .fillColor(brandPrimary)
      .text(`Total Credit: ${input.creditNote.totalCredit.toFixed(2)}`, 380, doc.y, {
        width: 168,
        align: 'right',
      });

    doc.end();
  });
}

export function generatePaymentReceiptPdfBuffer(input: {
  payment: CustomerPayment;
  customer: Customer;
  businessProfile: BrandingProfile | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(16).text('Payment Receipt', { align: 'right' });
    doc.fontSize(11).text(`Payment #: ${input.payment.paymentNumber}`, { align: 'right' });
    doc.text(`Payment Date: ${input.payment.paymentDate}`, { align: 'right' });
    doc.text(`Method: ${input.payment.paymentMethod}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Customer');
    doc.fontSize(11).text(input.customer.displayName);
    if (input.customer.address) {
      doc.text(input.customer.address);
    }
    if (input.customer.email) {
      doc.text(input.customer.email);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Reference');
    doc.fontSize(11).text(input.payment.reference);
    if (input.payment.notes) {
      doc.moveDown(0.6);
      doc.fontSize(12).text('Notes');
      doc.fontSize(11).text(input.payment.notes);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Allocations');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Invoice ID', 50, doc.y, { width: 390 });
    doc.text('Allocated', 430, doc.y - 12, { width: 118, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    for (const allocation of input.payment.allocations) {
      doc.moveDown(0.6);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(allocation.invoiceId, 50, y, { width: 390 });
      doc.text(allocation.amount.toFixed(2), 430, y, { width: 118, align: 'right' });
    }

    doc.moveDown(1.2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(330, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown(0.5);
    doc
      .fontSize(13)
      .fillColor(brandPrimary)
      .text(`Total Payment: ${input.payment.amount.toFixed(2)}`, 380, doc.y, {
        width: 168,
        align: 'right',
      });

    doc.end();
  });
}

export function generateSupplierBillPdfBuffer(input: {
  bill: SupplierBill;
  lineItems: SupplierBillLineItemInput[];
  supplier: Supplier;
  businessProfile: BrandingProfile | null;
  sourcePurchaseOrderNumber?: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(16).text('Supplier Bill', { align: 'right' });
    doc.fontSize(11).text(`Bill Number: ${input.bill.billNumber ?? 'Draft'}`, { align: 'right' });
    doc.text(`Bill Date: ${input.bill.billDate}`, { align: 'right' });
    doc.text(`Due Date: ${input.bill.dueDate}`, { align: 'right' });
    doc.text(`Status: ${input.bill.status}`, { align: 'right' });
    if (input.sourcePurchaseOrderNumber) {
      doc.text(`Source PO: ${input.sourcePurchaseOrderNumber}`, { align: 'right' });
    }

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Supplier');
    doc.fontSize(11).text(input.supplier.displayName);
    if (input.supplier.address) {
      doc.text(input.supplier.address);
    }
    if (input.supplier.email) {
      doc.text(input.supplier.email);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Line Items');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Description', 50, doc.y, { width: 220 });
    doc.text('Qty', 280, doc.y - 12, { width: 60, align: 'right' });
    doc.text('Unit', 345, doc.y - 12, { width: 80, align: 'right' });
    doc.text('GST', 430, doc.y - 12, { width: 50, align: 'right' });
    doc.text('Total', 485, doc.y - 12, { width: 70, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    for (const item of input.lineItems) {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineGst = item.gstApplicable ? lineSubtotal * 0.1 : 0;
      const lineTotal = lineSubtotal + lineGst;

      doc.moveDown(0.6);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(item.description, 50, y, { width: 220 });
      doc.text(item.quantity.toFixed(2), 280, y, { width: 60, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), 345, y, { width: 80, align: 'right' });
      doc.text(lineGst.toFixed(2), 430, y, { width: 50, align: 'right' });
      doc.text(lineTotal.toFixed(2), 485, y, { width: 70, align: 'right' });
    }

    doc.moveDown(1.2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(330, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Subtotal: ${input.bill.totals.subtotal.toFixed(2)}`, 380, doc.y, {
      width: 168,
      align: 'right',
    });
    doc.text(`GST: ${input.bill.totals.gstTotal.toFixed(2)}`, 380, doc.y + 2, {
      width: 168,
      align: 'right',
    });
    doc
      .fontSize(13)
      .fillColor(brandPrimary)
      .text(`Total: ${input.bill.totals.total.toFixed(2)} ${input.bill.currency}`, 380, doc.y + 4, {
        width: 168,
        align: 'right',
      });

    if (input.bill.notes) {
      doc.moveDown(1.4);
      doc.fillColor('#111827').fontSize(11).text('Notes');
      doc.fontSize(10).fillColor('#4b5563').text(input.bill.notes, { width: 500 });
    }

    doc.end();
  });
}

export function generateSupplierPaymentReceiptPdfBuffer(input: {
  payment: SupplierBillPayment;
  supplier: Supplier;
  businessProfile: BrandingProfile | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(16).text('Supplier Payment Receipt', { align: 'right' });
    doc.fontSize(11).text(`Payment #: ${input.payment.paymentNumber}`, { align: 'right' });
    doc.text(`Payment Date: ${input.payment.paymentDate}`, { align: 'right' });
    doc.text(`Method: ${input.payment.paymentMethod}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Supplier');
    doc.fontSize(11).text(input.supplier.displayName);
    if (input.supplier.address) {
      doc.text(input.supplier.address);
    }
    if (input.supplier.email) {
      doc.text(input.supplier.email);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Reference');
    doc.fontSize(11).text(input.payment.reference);
    if (input.payment.notes) {
      doc.moveDown(0.6);
      doc.fontSize(12).text('Notes');
      doc.fontSize(11).text(input.payment.notes);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Allocations');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Supplier Bill ID', 50, doc.y, { width: 390 });
    doc.text('Allocated', 430, doc.y - 12, { width: 118, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    for (const allocation of input.payment.allocations) {
      doc.moveDown(0.6);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(allocation.supplierBillId, 50, y, { width: 390 });
      doc.text(allocation.amount.toFixed(2), 430, y, { width: 118, align: 'right' });
    }

    doc.moveDown(1.2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(330, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown(0.5);
    doc
      .fontSize(13)
      .fillColor(brandPrimary)
      .text(`Total Payment: ${input.payment.amount.toFixed(2)}`, 380, doc.y, {
        width: 168,
        align: 'right',
      });

    doc.end();
  });
}

export function generatePurchaseOrderPdfBuffer(input: {
  purchaseOrder: PurchaseOrder;
  lineItems: PurchaseOrderLineItemInput[];
  supplier: Supplier;
  businessProfile: BrandingProfile | null;
  linkedSupplierBills?: Array<{ billNumber: string | null; status: string; total: number }>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const brandPrimary = profile?.primaryColor ?? '#0f172a';

    writeBrandedHeader(doc, profile, brandPrimary);
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(16).text('Purchase Order', { align: 'right' });
    doc.fontSize(11).text(`PO Number: ${input.purchaseOrder.purchaseOrderNumber}`, { align: 'right' });
    doc.text(`Issue Date: ${input.purchaseOrder.issueDate}`, { align: 'right' });
    doc.text(`Status: ${input.purchaseOrder.status}`, { align: 'right' });
    if (input.purchaseOrder.closeReason) {
      doc.text(`Close Reason: ${input.purchaseOrder.closeReason}`, { align: 'right' });
    }
    if (input.purchaseOrder.closedDate) {
      doc.text(`Closed Date: ${input.purchaseOrder.closedDate}`, { align: 'right' });
    }
    doc.text(`Billing: ${input.purchaseOrder.billingStatus}`, { align: 'right' });
    doc.text(`Billed: ${input.purchaseOrder.totalBilledAmount.toFixed(2)}`, { align: 'right' });
    doc.text(`Remaining: ${input.purchaseOrder.remainingUnbilledAmount.toFixed(2)}`, { align: 'right' });
    if (input.purchaseOrder.expectedDeliveryDate) {
      doc.text(`Expected Delivery: ${input.purchaseOrder.expectedDeliveryDate}`, { align: 'right' });
    }

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Supplier');
    doc.fontSize(11).text(input.supplier.displayName);
    if (input.supplier.address) {
      doc.text(input.supplier.address);
    }
    if (input.supplier.email) {
      doc.text(input.supplier.email);
    }

    doc.moveDown(1);
    doc.fontSize(12).text('Line Items');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#6b7280').text('Description', 50, doc.y, { width: 220 });
    doc.text('Qty', 280, doc.y - 12, { width: 60, align: 'right' });
    doc.text('Unit', 345, doc.y - 12, { width: 80, align: 'right' });
    doc.text('GST', 430, doc.y - 12, { width: 50, align: 'right' });
    doc.text('Total', 485, doc.y - 12, { width: 70, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();

    for (const item of input.lineItems) {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineGst = item.gstApplicable ? lineSubtotal * 0.1 : 0;
      const lineTotal = lineSubtotal + lineGst;

      doc.moveDown(0.6);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(item.description, 50, y, { width: 220 });
      doc.text(item.quantity.toFixed(2), 280, y, { width: 60, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), 345, y, { width: 80, align: 'right' });
      doc.text(lineGst.toFixed(2), 430, y, { width: 50, align: 'right' });
      doc.text(lineTotal.toFixed(2), 485, y, { width: 70, align: 'right' });
    }

    doc.moveDown(1.2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(330, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Subtotal: ${input.purchaseOrder.totals.subtotal.toFixed(2)}`, 380, doc.y, {
      width: 168,
      align: 'right',
    });
    doc.text(`GST: ${input.purchaseOrder.totals.gstTotal.toFixed(2)}`, 380, doc.y + 2, {
      width: 168,
      align: 'right',
    });
    doc.fontSize(13).fillColor(brandPrimary).text(
      `Total: ${input.purchaseOrder.totals.total.toFixed(2)} ${input.purchaseOrder.currency}`,
      380,
      doc.y + 4,
      {
        width: 168,
        align: 'right',
      },
    );

    if (input.purchaseOrder.notes) {
      doc.moveDown(1.4);
      doc.fillColor('#111827').fontSize(11).text('Notes');
      doc.fontSize(10).fillColor('#4b5563').text(input.purchaseOrder.notes, { width: 500 });
    }

    if (input.linkedSupplierBills && input.linkedSupplierBills.length > 0) {
      doc.moveDown(1);
      doc.fillColor('#111827').fontSize(11).text('Linked Supplier Bills');
      for (const linkedBill of input.linkedSupplierBills) {
        doc
          .fontSize(10)
          .fillColor('#4b5563')
          .text(
            `${linkedBill.billNumber ?? 'Draft'} | ${linkedBill.status} | ${linkedBill.total.toFixed(2)}`,
            { width: 500 },
          );
      }
    }

    doc.end();
  });
}
