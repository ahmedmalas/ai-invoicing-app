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
import {
  drawAlignedTotals,
  drawPaymentDetailsBlock,
  ensureContentFitsPage,
  gstStatusLabel,
  pageContentRight,
  pageContentWidth,
  PDF_PAGE_MARGIN,
  type InvoicePdfBankDetails,
  type InvoicePdfPageSize,
} from './invoice-pdf-layout.js';
import { drawBusinessLogoMark } from './logo-pdf.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

function writeBrandedHeader(
  doc: PdfDoc,
  profile: BrandingProfile | null,
  brandPrimary: string,
): void {
  const logoHeight = drawBusinessLogoMark(doc, profile, PDF_PAGE_MARGIN, PDF_PAGE_MARGIN, 44);
  const textX = logoHeight > 0 ? PDF_PAGE_MARGIN + 56 : PDF_PAGE_MARGIN;
  const textY = logoHeight > 0 ? PDF_PAGE_MARGIN + 4 : PDF_PAGE_MARGIN;
  const nameWidth = Math.max(160, pageContentWidth(doc) - (textX - PDF_PAGE_MARGIN) - 160);
  doc
    .fillColor(brandPrimary)
    .fontSize(22)
    .font('Helvetica-Bold')
    .text(profile?.companyName ?? 'Business Name', textX, textY, { width: nameWidth });
  doc.x = PDF_PAGE_MARGIN;
  doc.y = Math.max(doc.y, PDF_PAGE_MARGIN + (logoHeight || 28)) + 4;
  doc.font('Helvetica');
}

function writeBusinessIdentityBlock(doc: PdfDoc, profile: BrandingProfile | null, gstStatus: string): void {
  const width = pageContentWidth(doc);
  doc.fillColor('#111827').fontSize(11);
  doc.text(profile?.address?.trim() || 'Business address not set', PDF_PAGE_MARGIN, doc.y, {
    width,
    align: 'left',
    lineGap: 2,
  });
  if (profile?.abnTaxId?.trim()) {
    doc.text(`ABN: ${profile.abnTaxId.trim()}`, { width, align: 'left' });
  }
  if (profile?.email?.trim()) {
    doc.text(`Email: ${profile.email.trim()}`, { width, align: 'left' });
  }
  if (profile?.phone?.trim()) {
    doc.text(`Phone: ${profile.phone.trim()}`, { width, align: 'left' });
  }
  doc.fillColor('#4b5563').fontSize(10).text(`GST status: ${gstStatus}`, { width, align: 'left' });
}

export function generateInvoicePdfBuffer(input: {
  invoice: InvoiceDraft;
  lineItems: LineItemInput[];
  customer: Customer;
  businessProfile: BrandingProfile | null;
  /** Optional bank transfer details for future profile wiring. */
  bankDetails?: InvoicePdfBankDetails | null;
  /** Page size for export / print parity (default A4). */
  pageSize?: InvoicePdfPageSize;
  timeoutMs?: number;
}): Promise<Buffer> {
  const timeoutMs = Math.max(1_000, Math.trunc(input.timeoutMs ?? 20_000));
  const pageSize = input.pageSize ?? 'A4';
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: pageSize,
      margins: {
        top: PDF_PAGE_MARGIN,
        left: PDF_PAGE_MARGIN,
        right: PDF_PAGE_MARGIN,
        bottom: PDF_PAGE_MARGIN,
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
    const brandPrimary = profile?.primaryColor ?? '#0f172a';
    const gstStatus = gstStatusLabel(input.lineItems);
    const contentRight = () => pageContentRight(doc);
    const contentWidth = () => pageContentWidth(doc);

    writeBrandedHeader(doc, profile, brandPrimary);
    writeBusinessIdentityBlock(doc, profile, gstStatus);

    doc.moveDown(1);
    doc.fontSize(18).fillColor('#111827').text('TAX INVOICE', {
      width: contentWidth(),
      align: 'right',
    });
    doc.fontSize(11).text(`Invoice Number: ${input.invoice.invoiceNumber ?? 'Draft'}`, {
      width: contentWidth(),
      align: 'right',
    });
    doc.text(`Issue Date: ${input.invoice.issueDate}`, {
      width: contentWidth(),
      align: 'right',
    });
    doc.text(`Due Date: ${input.invoice.dueDate}`, {
      width: contentWidth(),
      align: 'right',
    });
    if (input.invoice.title) {
      doc.text(`Title: ${input.invoice.title}`, {
        width: contentWidth(),
        align: 'right',
      });
    }

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Bill To', PDF_PAGE_MARGIN, doc.y, {
      width: contentWidth(),
      align: 'left',
    });
    doc.fontSize(11).text(input.customer.displayName, { width: contentWidth(), align: 'left' });
    if (input.customer.address) {
      doc.text(input.customer.address, { width: contentWidth(), align: 'left' });
    }
    if (input.customer.email) {
      doc.text(input.customer.email, { width: contentWidth(), align: 'left' });
    }

    doc.moveDown(1);
    ensureContentFitsPage(doc, 40);
    doc.fontSize(12).fillColor('#111827').text('Line Items', PDF_PAGE_MARGIN, doc.y, {
      width: contentWidth(),
      align: 'left',
    });
    doc.moveDown(0.4);

    const col = {
      description: { x: PDF_PAGE_MARGIN + 2, width: 220 },
      qty: { x: PDF_PAGE_MARGIN + 230, width: 50 },
      unit: { x: PDF_PAGE_MARGIN + 285, width: 70 },
      gst: { x: PDF_PAGE_MARGIN + 360, width: 55 },
      total: { x: contentRight() - 70, width: 70 },
    };

    const headerY = doc.y;
    doc.fontSize(10).fillColor('#6b7280');
    doc.text('Description', col.description.x, headerY, { width: col.description.width });
    doc.text('Qty', col.qty.x, headerY, { width: col.qty.width, align: 'right' });
    doc.text('Unit', col.unit.x, headerY, { width: col.unit.width, align: 'right' });
    doc.text('GST', col.gst.x, headerY, { width: col.gst.width, align: 'right' });
    doc.text('Total', col.total.x, headerY, { width: col.total.width, align: 'right' });

    doc.moveDown(0.4);
    doc
      .strokeColor('#d1d5db')
      .lineWidth(1)
      .moveTo(PDF_PAGE_MARGIN, doc.y)
      .lineTo(contentRight(), doc.y)
      .stroke();

    for (const item of input.lineItems) {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineGst = item.gstApplicable ? lineSubtotal * 0.1 : 0;
      const lineTotal = lineSubtotal + lineGst;

      ensureContentFitsPage(doc, 28);
      doc.moveDown(0.55);
      const y = doc.y;
      doc.fillColor('#111827').fontSize(10).text(item.description, col.description.x, y, {
        width: col.description.width,
      });
      const rowBottom = doc.y;
      doc.text(item.quantity.toFixed(2), col.qty.x, y, { width: col.qty.width, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), col.unit.x, y, { width: col.unit.width, align: 'right' });
      doc.text(lineGst.toFixed(2), col.gst.x, y, { width: col.gst.width, align: 'right' });
      doc.text(lineTotal.toFixed(2), col.total.x, y, { width: col.total.width, align: 'right' });
      doc.y = Math.max(rowBottom, doc.y);
      doc.x = PDF_PAGE_MARGIN;
    }

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

    if (input.invoice.notes) {
      ensureContentFitsPage(doc, 40);
      doc.moveDown(1.1);
      doc.fillColor('#111827').fontSize(11).text('Notes', PDF_PAGE_MARGIN, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.fontSize(10).fillColor('#4b5563').text(input.invoice.notes, {
        width: contentWidth(),
        align: 'left',
        lineGap: 3,
      });
    }

    if (input.invoice.paymentTerms) {
      ensureContentFitsPage(doc, 36);
      doc.moveDown(0.9);
      doc.fillColor('#111827').fontSize(11).text('Payment terms', PDF_PAGE_MARGIN, doc.y, {
        width: contentWidth(),
        align: 'left',
      });
      doc.fontSize(10).fillColor('#4b5563').text(input.invoice.paymentTerms, {
        width: contentWidth(),
        align: 'left',
        lineGap: 3,
      });
    }

    // Invoice ends after business / payment information — no generated-by branding footer.
    drawPaymentDetailsBlock(doc, profile, input.bankDetails);
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
