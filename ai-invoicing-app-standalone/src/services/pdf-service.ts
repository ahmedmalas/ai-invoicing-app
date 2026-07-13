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
  Quote,
  Supplier,
  SupplierBill,
  SupplierBillPayment,
  SupplierBillLineItemInput,
} from '../types/entities.js';
import type { CustomerStatementReport } from '../db/database.js';

export function generateQuotePdfBuffer(input: {
  quote: Quote;
  lineItems: LineItemInput[];
  customer: Customer;
  businessProfile: BrandingProfile | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const profile = input.businessProfile;
    const primary = profile?.primaryColor ?? '#102a43';
    doc.fillColor(primary).fontSize(24).text(profile?.companyName ?? 'ABoss');
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(10).text(profile?.address ?? '');
    if (profile?.email) doc.text(profile.email);
    if (profile?.phone) doc.text(profile.phone);

    doc.fontSize(19).fillColor('#111827').text('Quote', { align: 'right' });
    doc.fontSize(10).text(`Quote number: ${input.quote.quoteNumber}`, { align: 'right' });
    doc.text(`Issue date: ${input.quote.issueDate}`, { align: 'right' });
    doc.text(`Valid until: ${input.quote.expiryDate}`, { align: 'right' });
    doc.text(`Status: ${input.quote.status}`, { align: 'right' });

    doc.moveDown(1.2).fontSize(12).text('Prepared for');
    doc.fontSize(10).text(input.customer.displayName);
    if (input.customer.address) doc.text(input.customer.address);
    if (input.customer.email) doc.text(input.customer.email);

    doc.moveDown(1).fontSize(12).text(input.quote.title);
    doc.moveDown(0.5);
    const headerY = doc.y;
    doc.fillColor('#64748b').fontSize(9).text('Description', 50, headerY, { width: 230 });
    doc.text('Qty', 290, headerY, { width: 55, align: 'right' });
    doc.text('Unit', 355, headerY, { width: 75, align: 'right' });
    doc.text('GST', 440, headerY, { width: 45, align: 'right' });
    doc.text('Total', 495, headerY, { width: 55, align: 'right' });
    doc.moveDown(0.45).strokeColor('#cbd5e1').moveTo(48, doc.y).lineTo(550, doc.y).stroke();

    for (const item of input.lineItems) {
      const subtotal = item.quantity * item.unitPrice;
      const gst = item.gstApplicable ? subtotal * 0.1 : 0;
      const y = doc.y + 8;
      doc.fillColor('#111827').fontSize(9).text(item.description, 50, y, { width: 230 });
      doc.text(item.quantity.toFixed(2), 290, y, { width: 55, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), 355, y, { width: 75, align: 'right' });
      doc.text(gst.toFixed(2), 440, y, { width: 45, align: 'right' });
      doc.text((subtotal + gst).toFixed(2), 495, y, { width: 55, align: 'right' });
      doc.y = y + 22;
    }

    doc.moveDown(0.5).strokeColor('#e2e8f0').moveTo(350, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.45).fontSize(10).text(`Subtotal: $${input.quote.totals.subtotal.toFixed(2)}`, 370, doc.y, { width: 180, align: 'right' });
    doc.text(`GST: $${input.quote.totals.gstTotal.toFixed(2)}`, 370, doc.y + 2, { width: 180, align: 'right' });
    doc.fillColor(primary).fontSize(13).text(`Total: $${input.quote.totals.total.toFixed(2)}`, 370, doc.y + 5, { width: 180, align: 'right' });

    if (input.quote.notes) {
      doc.moveDown(1.5).fillColor('#111827').fontSize(10).text('Notes');
      doc.fillColor('#475569').fontSize(9).text(input.quote.notes);
    }
    if (input.quote.paymentTerms) {
      doc.moveDown(0.7).fillColor('#111827').fontSize(10).text('Terms');
      doc.fillColor('#475569').fontSize(9).text(input.quote.paymentTerms);
    }
    doc.end();
  });
}

export function generateInvoicePdfBuffer(input: {
  invoice: InvoiceDraft;
  lineItems: LineItemInput[];
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
    doc.moveDown(0.2);
    doc.fillColor('#111827').fontSize(11).text(profile?.address ?? 'Business address not set');
    if (profile?.email) {
      doc.text(`Email: ${profile.email}`);
    }
    if (profile?.phone) {
      doc.text(`Phone: ${profile.phone}`);
    }

    doc.moveDown(1);
    doc.fontSize(18).fillColor('#111827').text('Tax Invoice', { align: 'right' });
    doc.fontSize(11).text(`Invoice Number: ${input.invoice.invoiceNumber ?? 'Draft'}`, {
      align: 'right',
    });
    doc.text(`Issue Date: ${input.invoice.issueDate}`, { align: 'right' });
    doc.text(`Due Date: ${input.invoice.dueDate}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#111827').text('Bill To');
    doc.fontSize(11).text(input.customer.displayName);
    if (input.customer.address) {
      doc.text(input.customer.address);
    }
    if (input.customer.email) {
      doc.text(input.customer.email);
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
    doc.fontSize(11).text(`Subtotal: ${input.invoice.totals.subtotal.toFixed(2)}`, 380, doc.y, {
      width: 168,
      align: 'right',
    });
    doc.text(`GST: ${input.invoice.totals.gstTotal.toFixed(2)}`, 380, doc.y + 2, {
      width: 168,
      align: 'right',
    });
    doc
      .fontSize(13)
      .fillColor(brandPrimary)
      .text(`Total: ${input.invoice.totals.total.toFixed(2)}`, 380, doc.y + 4, {
        width: 168,
        align: 'right',
      });

    if (input.invoice.notes) {
      doc.moveDown(1.4);
      doc.fillColor('#111827').fontSize(11).text('Notes');
      doc.fontSize(10).fillColor('#4b5563').text(input.invoice.notes, { width: 500 });
    }

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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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

    doc.fillColor(brandPrimary).fontSize(24).text(profile?.companyName ?? 'Business Name');
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
