import PDFDocument from 'pdfkit';

import type { BrandingProfile, Customer, InvoiceDraft, LineItemInput } from '../../types/entities.js';
import { drawBusinessLogoMark } from '../../services/logo-pdf.js';
import type { InvoiceTemplateDesign } from './invoice-template-design.js';
import { defaultInvoiceTemplateDesign } from './invoice-template-design.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

function applyLogoFromDesign(
  doc: PdfDoc,
  design: InvoiceTemplateDesign,
  profile: BrandingProfile | null,
  x: number,
  y: number,
): number {
  const dataUrl = design.businessDefaults.logoDataUrl;
  if (dataUrl?.startsWith('data:image/')) {
    try {
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        const buf = Buffer.from(base64, 'base64');
        doc.image(buf, x, y, { height: 44, fit: [120, 44] });
        return 44;
      }
    } catch {
      // fall through to profile logo
    }
  }
  return drawBusinessLogoMark(doc, profile, x, y, 44);
}

/**
 * Render an invoice PDF using an imported/editable template design.
 * Transactional content still comes from the live invoice/customer records.
 */
export function generateTemplatedInvoicePdfBuffer(input: {
  invoice: InvoiceDraft;
  lineItems: LineItemInput[];
  customer: Customer;
  businessProfile: BrandingProfile | null;
  design?: InvoiceTemplateDesign | null;
}): Promise<Buffer> {
  const design = input.design
    ? defaultInvoiceTemplateDesign(input.design)
    : defaultInvoiceTemplateDesign();

  return new Promise((resolve, reject) => {
    const margins = design.layout.margins;
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: margins.top,
        bottom: margins.bottom,
        left: margins.left,
        right: margins.right,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const profile = input.businessProfile;
    const primary = design.colors.primary || profile?.primaryColor || '#173f35';
    const textColor = design.colors.text;
    const muted = design.colors.muted;
    const border = design.colors.border;
    const headingFont = design.typography.headingFont;
    const bodyFont = design.typography.bodyFont;
    const pageWidth = doc.page.width - margins.left - margins.right;

    if (design.watermark?.text) {
      doc.save();
      doc
        .fillColor(muted)
        .opacity(design.watermark.opacity)
        .font(headingFont)
        .fontSize(48)
        .text(design.watermark.text, margins.left, doc.page.height / 2 - 40, {
          width: pageWidth,
          align: 'center',
        });
      doc.restore();
      doc.opacity(1);
    }

    const companyName =
      design.businessDefaults.companyName || profile?.companyName || 'Business Name';
    const address = design.businessDefaults.address || profile?.address || '';
    const abn = design.businessDefaults.abnTaxId || profile?.abnTaxId || '';
    const email = design.businessDefaults.email || profile?.email || '';
    const phone = design.businessDefaults.phone || profile?.phone || '';
    const website = design.businessDefaults.website || '';

    const logoH = applyLogoFromDesign(doc, design, profile, margins.left, margins.top);
    const textX = logoH > 0 ? margins.left + 90 : margins.left;
    const textY = logoH > 0 ? margins.top + 4 : margins.top;

    doc
      .fillColor(primary)
      .font(headingFont)
      .fontSize(design.typography.titleSize)
      .text(companyName, textX, textY, { width: pageWidth * 0.5 });

    doc.x = margins.left;
    doc.y = Math.max(doc.y, margins.top + (logoH || 28)) + 6;
    doc.fillColor(textColor).font(bodyFont).fontSize(design.typography.bodySize);
    if (address) doc.text(address, { width: pageWidth * 0.55 });
    if (abn) doc.text(`ABN: ${abn}`);
    if (email) doc.text(`Email: ${email}`);
    if (phone) doc.text(`Phone: ${phone}`);
    if (website) doc.text(website);

    if (design.borders.headerRule) {
      doc
        .moveDown(0.4)
        .strokeColor(primary)
        .lineWidth(design.borders.width)
        .moveTo(margins.left, doc.y)
        .lineTo(margins.left + pageWidth, doc.y)
        .stroke();
      doc.moveDown(0.6);
    } else {
      doc.moveDown(0.8);
    }

    const titleY = doc.y;
    doc
      .fillColor(primary)
      .font(headingFont)
      .fontSize(design.typography.titleSize)
      .text(design.documentTitle, margins.left, titleY, { width: pageWidth, align: 'right' });
    doc
      .fillColor(textColor)
      .font(bodyFont)
      .fontSize(design.typography.bodySize)
      .text(`Invoice Number: ${input.invoice.invoiceNumber ?? 'Draft'}`, {
        align: 'right',
      })
      .text(`Issue Date: ${input.invoice.issueDate}`, { align: 'right' })
      .text(`Due Date: ${input.invoice.dueDate}`, { align: 'right' });

    doc.moveDown(1);
    doc
      .fillColor(textColor)
      .font(headingFont)
      .fontSize(design.typography.headingSize)
      .text('Bill To');
    doc.font(bodyFont).fontSize(design.typography.bodySize);
    doc.text(input.customer.displayName);
    if (input.customer.address) doc.text(input.customer.address);
    if (input.customer.email) doc.text(input.customer.email);

    doc.moveDown(1);
    doc.font(headingFont).fontSize(design.typography.headingSize).text('Line Items');
    doc.moveDown(0.3);

    const colY = doc.y;
    doc.fillColor(muted).font(bodyFont).fontSize(9);
    doc.text('Description', margins.left + 2, colY, { width: 220 });
    doc.text('Qty', margins.left + 230, colY, { width: 50, align: 'right' });
    doc.text('Unit', margins.left + 290, colY, { width: 70, align: 'right' });
    doc.text('GST', margins.left + 370, colY, { width: 50, align: 'right' });
    doc.text('Total', margins.left + 430, colY, { width: 70, align: 'right' });

    if (design.borders.table) {
      doc
        .moveDown(0.35)
        .strokeColor(border)
        .lineWidth(design.borders.width)
        .moveTo(margins.left, doc.y)
        .lineTo(margins.left + pageWidth, doc.y)
        .stroke();
    }

    for (const item of input.lineItems) {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineGst = item.gstApplicable ? lineSubtotal * 0.1 : 0;
      const lineTotal = lineSubtotal + lineGst;
      doc.moveDown(0.55);
      const y = doc.y;
      doc.fillColor(textColor).font(bodyFont).fontSize(design.typography.bodySize);
      doc.text(item.description, margins.left + 2, y, { width: 220 });
      doc.text(item.quantity.toFixed(2), margins.left + 230, y, { width: 50, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), margins.left + 290, y, { width: 70, align: 'right' });
      doc.text(lineGst.toFixed(2), margins.left + 370, y, { width: 50, align: 'right' });
      doc.text(lineTotal.toFixed(2), margins.left + 430, y, { width: 70, align: 'right' });
    }

    doc.moveDown(1.1);
    doc
      .strokeColor(border)
      .lineWidth(1)
      .moveTo(margins.left + pageWidth * 0.55, doc.y)
      .lineTo(margins.left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.45);
    const totalsX = margins.left + pageWidth * 0.55;
    doc.fillColor(textColor).font(bodyFont).fontSize(design.typography.bodySize);
    doc.text(`Subtotal: ${input.invoice.totals.subtotal.toFixed(2)}`, totalsX, doc.y, {
      width: pageWidth * 0.45,
      align: 'right',
    });
    doc.text(`GST: ${input.invoice.totals.gstTotal.toFixed(2)}`, totalsX, doc.y + 2, {
      width: pageWidth * 0.45,
      align: 'right',
    });
    doc
      .fillColor(primary)
      .font(headingFont)
      .fontSize(design.typography.headingSize + 1)
      .text(`Total: ${input.invoice.totals.total.toFixed(2)}`, totalsX, doc.y + 4, {
        width: pageWidth * 0.45,
        align: 'right',
      });

    const paymentText =
      design.paymentDetails ||
      [
        companyName ? `Pay to: ${companyName}` : null,
        abn ? `ABN: ${abn}` : null,
        email ? `Accounts: ${email}` : null,
        phone ? `Phone: ${phone}` : null,
      ]
        .filter(Boolean)
        .join('\n') ||
      'Configure payment details in your invoice template.';

    doc.moveDown(1.2);
    doc.fillColor(textColor).font(headingFont).fontSize(design.typography.headingSize).text('Payment details');
    doc.font(bodyFont).fontSize(design.typography.bodySize).fillColor(muted).text(paymentText, {
      width: pageWidth,
    });

    if (design.termsAndConditions || input.invoice.paymentTerms) {
      doc.moveDown(0.9);
      doc.fillColor(textColor).font(headingFont).fontSize(design.typography.headingSize).text('Terms & Conditions');
      doc
        .font(bodyFont)
        .fontSize(design.typography.bodySize)
        .fillColor(muted)
        .text(design.termsAndConditions || input.invoice.paymentTerms || '', { width: pageWidth });
    }

    if (input.invoice.notes || design.notesPlaceholder) {
      doc.moveDown(0.9);
      doc.fillColor(textColor).font(headingFont).fontSize(design.typography.headingSize).text('Notes');
      doc
        .font(bodyFont)
        .fontSize(design.typography.bodySize)
        .fillColor(muted)
        .text(input.invoice.notes || design.notesPlaceholder || '', { width: pageWidth });
    }

    doc.moveDown(1.2);
    doc
      .fillColor(muted)
      .font(bodyFont)
      .fontSize(9)
      .text(`Generated by Aleya Invoicing · ${companyName}`, {
        width: pageWidth,
        align: 'center',
      });

    doc.end();
  });
}

/** Preview PDF of the template alone (placeholder transactional fields). */
export function generateTemplatePreviewPdfBuffer(input: {
  design: InvoiceTemplateDesign;
  businessProfile?: BrandingProfile | null;
}): Promise<Buffer> {
  const now = new Date().toISOString().slice(0, 10);
  const design = defaultInvoiceTemplateDesign(input.design);
  const placeholderCustomer: Customer = {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Sample Customer',
    email: 'customer@example.com',
    phone: null,
    address: 'Customer address on file',
    abnTaxId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
  const placeholderInvoice: InvoiceDraft = {
    id: '00000000-0000-4000-8000-000000000002',
    customerId: placeholderCustomer.id,
    title: design.documentTitle,
    issueDate: now,
    dueDate: now,
    invoiceNumber: null,
    status: 'Draft',
    paymentState: 'Draft',
    reminderState: 'None',
    notes: design.notesPlaceholder,
    paymentTerms: design.termsAndConditions,
    totals: { subtotal: 100, gstTotal: 10, total: 110 },
    createdAt: now,
    updatedAt: now,
  };
  const lineItems: LineItemInput[] = [
    {
      description: 'Sample line item',
      quantity: 1,
      unitPrice: 100,
      gstApplicable: true,
    },
  ];
  return generateTemplatedInvoicePdfBuffer({
    invoice: placeholderInvoice,
    lineItems,
    customer: placeholderCustomer,
    businessProfile: input.businessProfile ?? null,
    design,
  });
}
