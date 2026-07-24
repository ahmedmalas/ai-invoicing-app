import zlib from 'node:zlib';

import {
  defaultInvoiceTemplateDesign,
  type InvoiceTemplateDesign,
} from './invoice-template-design.js';

export const SUPPORTED_IMPORT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export type SupportedImportMimeType = (typeof SUPPORTED_IMPORT_MIME_TYPES)[number];

export interface AnalyzeInvoiceDocumentInput {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface ExtractedSampleLine {
  date?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface AnalyzeInvoiceDocumentResult {
  design: InvoiceTemplateDesign;
  extractedTextPreview: string;
  detectedElements: string[];
  sampleLines: ExtractedSampleLine[];
  confidence: number;
  limitations: string[];
}

export function isSupportedImportMime(mimeType: string, filename: string): boolean {
  const normalized = normalizeMime(mimeType, filename);
  return (SUPPORTED_IMPORT_MIME_TYPES as readonly string[]).includes(normalized);
}

function normalizeMime(mimeType: string, filename: string): string {
  const lower = mimeType.toLowerCase().trim();
  if (lower && lower !== 'application/octet-stream') {
    if (lower === 'image/jpg') return 'image/jpeg';
    return lower;
  }
  const ext = filename.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return byExt[ext] || lower;
}

function looksLikeReadableText(value: string): boolean {
  if (!value.trim()) return false;
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const noise = (value.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  return letters >= 20 && noise / Math.max(1, value.length) < 0.15;
}

function extractLiteralRuns(decoded: string): string[] {
  const parts: string[] = [];
  for (const tj of decoded.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    let run = '';
    for (const token of (tj[1] ?? '').matchAll(/<([0-9a-fA-F]+)>|\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
      if (token[1]) {
        for (let i = 0; i + 1 < token[1].length; i += 2) {
          run += String.fromCharCode(Number.parseInt(token[1].slice(i, i + 2), 16));
        }
      } else if (token[2] !== undefined) {
        run += token[2]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
      }
    }
    if (run.trim()) parts.push(run);
  }
  for (const token of decoded.matchAll(/\((?:\\.|[^\\)]){2,200}\)(?:\s*Tj)/g)) {
    const inner = token[0]
      .replace(/\)\s*Tj$/i, '')
      .slice(1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-z0-9]/.test(inner)) parts.push(inner);
  }
  return parts;
}

/**
 * Lightweight PDF text scrape used when pdf.js is unavailable.
 * Only keeps content streams that look like page operators (BT/ET/Tj).
 */
export function extractTextFromPdfHeuristic(bytes: Buffer): string {
  const source = bytes.toString('latin1');
  const parts: string[] = [];

  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let decoded = '';
    try {
      decoded = zlib.inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      decoded = match[1] ?? '';
    }
    const hasOps = /\bBT\b|\bET\b|\bTj\b|\bTJ\b/.test(decoded);
    if (!hasOps) continue;
    parts.push(...extractLiteralRuns(decoded));
  }

  const joined = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return looksLikeReadableText(joined) ? joined : '';
}

/** Prefer pdf.js text layer extraction for real invoices (CID fonts, layout). */
export async function extractTextFromPdf(bytes: Buffer): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const line: string[] = [];
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(lastY - y) > 2) {
          pages.push(line.join(' ').trim());
          line.length = 0;
        }
        if (item.str) line.push(String(item.str));
        if (y !== null) lastY = y;
      }
      if (line.length) pages.push(line.join(' ').trim());
      pages.push('');
    }
    const text = pages.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (looksLikeReadableText(text)) return text;
  } catch {
    /* fall through to heuristic */
  }
  return extractTextFromPdfHeuristic(bytes);
}

function pickFirst(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function detectElements(text: string, mimeType: string): string[] {
  const found = new Set<string>();
  if (mimeType.startsWith('image/')) found.add('uploaded image');
  if (/tax\s*invoice|invoice/i.test(text)) found.add('invoice title');
  if (/abn/i.test(text)) found.add('ABN');
  if (/@/.test(text)) found.add('email');
  if (/(?:tel|phone|ph|m)\s*[:.]?\s*\d|\b0\d{8,10}\b|\+\d{8,}/i.test(text)) found.add('phone');
  if (/bill\s*to/i.test(text)) found.add('customer block');
  if (/\bfrom\b/i.test(text)) found.add('from / supplier block');
  if (/description|qty|quantity|rate|unit|amount/i.test(text)) found.add('line item table');
  if (/\bdate\b[\s\S]{0,40}\bdescription\b|\bdescription\b[\s\S]{0,40}\bqty\b/i.test(text)) {
    found.add('dated line columns');
  }
  if (/bsb|account\s*number|account\s*name/i.test(text)) found.add('payment / bank details');
  if (/subtotal|gst|total/i.test(text)) found.add('totals');
  if (/terms|payment\s*is\s*required|due\s*within/i.test(text)) found.add('terms');
  if (/please\s*note|thank\s*you/i.test(text)) found.add('notes');
  return [...found];
}

function extractSampleLines(text: string): ExtractedSampleLine[] {
  const lines: ExtractedSampleLine[] = [];
  const compact = text.replace(/\r/g, '');
  const rowRe =
    /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+([A-Za-z][A-Za-z0-9 &/'’.\-]{3,80}?)\s+(\d+(?:\.\d+)?)\s+\$?\s*([\d,]+(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(compact)) && lines.length < 12) {
    const quantity = Number(match[3]);
    const unitPrice = Number(String(match[4]).replace(/,/g, ''));
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
    lines.push({
      ...(match[1] ? { date: match[1] } : {}),
      description: match[2]!.trim(),
      quantity,
      unitPrice,
    });
  }
  return lines;
}

function extractBankDetails(text: string): InvoiceTemplateDesign['bankDetails'] {
  const accountName = pickFirst(
    [
      /Account\s*Name\s*[:.]?\s*([A-Za-z0-9 &.'’\-]{3,80})/i,
      /Pay\s*to\s*[:.]?\s*([A-Za-z0-9 &.'’\-]{3,80})/i,
    ],
    text,
  );
  const bsb = pickFirst([/BSB\s*[:.]?\s*([0-9\-]{6,9})/i], text);
  const accountNumber = pickFirst(
    [/Account\s*Number\s*[:.]?\s*([0-9]{4,12})/i, /Acc(?:ount)?\s*(?:No|#)\s*[:.]?\s*([0-9]{4,12})/i],
    text,
  );
  if (!accountName && !bsb && !accountNumber) return null;
  return {
    accountName,
    bsb,
    accountNumber,
    referenceLabel: /Reference/i.test(text) ? 'Reference' : null,
  };
}

function buildDesignFromText(
  text: string,
  mimeType: string,
  limitations: string[],
): {
  design: InvoiceTemplateDesign;
  detectedElements: string[];
  sampleLines: ExtractedSampleLine[];
  confidence: number;
} {
  const detectedElements = detectElements(text, mimeType);
  const sampleLines = extractSampleLines(text);
  const bankDetails = extractBankDetails(text);

  // Cart N Tip style: BILL TO / FROM labels then customer + supplier (often same line after pdf.js).
  const splitNames =
    text.match(
      /BILL\s*TO\s*:?\s*FROM\s*:?\s*\n?\s*([A-Za-z0-9 &.'’\-]+?(?:Pty Ltd|PTY LTD|Limited))\s+([A-Za-z0-9 &.'’\-]+?(?:Pty Ltd|PTY LTD|Limited))/i,
    ) ||
    text.match(
      /BILL\s*TO\s*:?\s*FROM\s*:?\s*\n?\s*([A-Za-z0-9 &.'’\-]{3,80})\s*\n\s*([A-Za-z0-9 &.'’\-]{3,80})/i,
    );
  const companyName =
    splitNames?.[2]?.trim() ||
    bankDetails?.accountName ||
    pickFirst(
      [
        /FROM\s*[:.]?\s*\n?\s*([A-Za-z0-9 &.'’\-]{3,80}(?:Pty Ltd|PTY LTD|Limited)?)/i,
        /([A-Za-z0-9 &.'’\-]{3,60}(?:Pty Ltd|PTY LTD))/i,
      ],
      text,
    );
  const abnTaxId = pickFirst([/ABN\s*[:.]?\s*([0-9 ]{8,14})/i], text);
  const email = pickFirst(
    [
      /E(?:mail)?\s*[:.]?\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i,
      /([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/,
    ],
    text,
  );
  const phone = pickFirst(
    [
      /(?:M|Ph|Phone|Tel)\s*[:.]?\s*(\+?\d[\d\s-]{7,})/i,
      /(\+61\s*\d[\d\s-]{7,}|\b0\d{8,10}\b)/,
    ],
    text,
  );
  const terms =
    pickFirst(
      [
        /TERMS\s*[:.]?\s*([^\n]{2,80})/i,
        /(Payment is required within[^\n.]{5,120})/i,
        /(Payment due within[^\n.]{5,120})/i,
      ],
      text,
    ) || null;
  const notes = pickFirst(
    [
      /PLEASE NOTE\s*[:.]?\s*([\s\S]{10,240}?)(?:SUBTOTAL|TOTAL|$)/i,
      /(Thank you for your business\.?)/i,
    ],
    text,
  );

  const hasDateColumn =
    detectedElements.includes('dated line columns') ||
    sampleLines.some((line) => Boolean(line.date)) ||
    /\bDATE\b[\s\S]{0,80}\bDESCRIPTION\b/i.test(text);
  const splitBillFrom = /BILL\s*TO/i.test(text) && /\bFROM\b/i.test(text);

  const paymentBlock = [
    bankDetails?.accountName ? `Account Name: ${bankDetails.accountName}` : null,
    bankDetails?.bsb ? `BSB: ${bankDetails.bsb}` : null,
    bankDetails?.accountNumber ? `Account Number: ${bankDetails.accountNumber}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const quantumLike = /quantum\s*hire|cart\s*and\s*tip/i.test(text);
  const design = defaultInvoiceTemplateDesign({
    documentTitle: /tax\s*invoice/i.test(text) ? 'TAX INVOICE' : 'INVOICE',
    ...(quantumLike
      ? {
          colors: {
            primary: '#00162b',
            secondary: '#7eb6d9',
            accent: '#00162b',
            text: '#111111',
            muted: '#4b5563',
            border: '#c5c9d0',
            background: '#ffffff',
          },
        }
      : {}),
    layout: {
      margins: { top: 40, right: 42, bottom: 40, left: 42 },
      headerStyle: splitBillFrom ? 'split-bill-from' : 'meta-right',
      logoPosition: 'left',
      layoutPreset:
        /quantum\s*hire|amount\s*\(ex\s*gst\)|cart\s*and\s*tip/i.test(text)
          ? 'quantum-hire'
          : 'standard',
      sections: defaultInvoiceTemplateDesign().layout.sections,
      tableColumns: [
        { id: 'lineNumber', label: '#', visible: !hasDateColumn },
        { id: 'date', label: hasDateColumn ? 'DATE' : 'Date', visible: hasDateColumn },
        { id: 'description', label: hasDateColumn ? 'DESCRIPTION' : 'Description', visible: true },
        { id: 'quantity', label: hasDateColumn ? 'QTY' : 'Qty', visible: true },
        {
          id: 'unitPrice',
          label: /\bRATE\b/i.test(text) ? 'RATE' : 'Unit',
          visible: true,
        },
        { id: 'gst', label: 'GST', visible: !/AMOUNT\s*\(EX\s*GST\)/i.test(text) },
        {
          id: 'amount',
          label: /AMOUNT\s*\(EX\s*GST\)/i.test(text) ? 'AMOUNT (EX GST)' : 'Total',
          visible: true,
        },
      ],
    },
    businessDefaults: {
      companyName,
      legalName: companyName,
      abnTaxId: abnTaxId ? abnTaxId.replace(/\s+/g, '') : null,
      address: null,
      email,
      phone,
      website: pickFirst([/(https?:\/\/[^\s]+|www\.[^\s]+)/i], text),
    },
    bankDetails,
    paymentDetails: paymentBlock || null,
    termsAndConditions: terms,
    notesPlaceholder: notes ? notes.replace(/\s+/g, ' ').trim().slice(0, 500) : null,
    analysisNotes: [
      'Recreated as editable Aleya fields — not a background image.',
      'Review every section before saving as your default template.',
      ...limitations,
    ],
  });

  let confidence = 0.35;
  if (detectedElements.length >= 5) confidence += 0.2;
  if (companyName) confidence += 0.1;
  if (abnTaxId) confidence += 0.1;
  if (bankDetails) confidence += 0.1;
  if (sampleLines.length) confidence += 0.1;
  if (mimeType.startsWith('image/')) confidence -= 0.15;
  if (!text) confidence = Math.min(confidence, 0.25);

  return {
    design,
    detectedElements,
    sampleLines,
    confidence: Math.max(0.15, Math.min(0.92, confidence)),
  };
}

/**
 * Analyse an uploaded invoice PDF/image into an editable template design.
 * Fonts/spacing from PDFs are approximate — users must review before saving.
 */
export async function analyzeInvoiceDocument(
  input: AnalyzeInvoiceDocumentInput,
): Promise<AnalyzeInvoiceDocumentResult> {
  const mimeType = normalizeMime(input.mimeType, input.filename);
  const limitations: string[] = [
    'Exact fonts and pixel spacing cannot be perfectly recovered from most PDFs/images.',
    'Transactional invoice numbers, customer names and line amounts are not locked into the template — new invoice data fills those fields.',
  ];

  let text = '';
  if (mimeType === 'application/pdf') {
    text = await extractTextFromPdf(input.bytes);
    if (!text) {
      limitations.push(
        'Could not extract text from this PDF; defaults were used and need manual editing.',
      );
    }
  } else if (mimeType.startsWith('image/')) {
    limitations.push(
      'Image OCR is not available in this environment — colours/layout defaults are applied; enter business details manually from the preview.',
    );
  } else {
    throw new Error('UNSUPPORTED_IMPORT_FORMAT');
  }

  const built = buildDesignFromText(text, mimeType, limitations);
  return {
    design: built.design,
    extractedTextPreview: text.slice(0, 4000),
    detectedElements: built.detectedElements,
    sampleLines: built.sampleLines,
    confidence: built.confidence,
    limitations,
  };
}
