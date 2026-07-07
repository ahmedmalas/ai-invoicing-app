import PDFDocument from 'pdfkit';

import type {
  BrandingProfile,
  CreditNote,
  Customer,
  InvoiceDraft,
  LineItemInput,
} from '../types/entities.js';
import type { CustomerStatementReport } from '../db/database.js';

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
