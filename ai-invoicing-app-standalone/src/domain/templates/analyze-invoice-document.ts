import JSZip from 'jszip';

import {
  defaultInvoiceTemplateDesign,
  type InvoiceTemplateDesign,
} from './invoice-template-design.js';

export const SUPPORTED_IMPORT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
] as const;

export type SupportedImportMimeType = (typeof SUPPORTED_IMPORT_MIME_TYPES)[number];

export interface AnalyzeInvoiceDocumentInput {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface AnalyzeInvoiceDocumentResult {
  design: InvoiceTemplateDesign;
  extractedTextPreview: string;
  detectedElements: string[];
  strippedTransactionalFields: string[];
  confidence: number;
}

const TRANSACTIONAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'invoice numbers', pattern: /\binvoice\s*(?:no|number|#)\s*[:#]?\s*[A-Z0-9-]+/gi },
  { label: 'dates', pattern: /\b(?:issue|due|invoice)\s*date\s*[:.]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/gi },
  {
    label: 'customer names',
    pattern: /\b(?:bill\s*to|sold\s*to|customer)\s*[:]\s*[A-Za-z0-9&'’.\- ]{2,80}?(?=\s+(?:ABN|Email|Phone|Tel|Address|Invoice|Tax|Payment|GST|Total)\b|$)/gi,
  },
  { label: 'prices', pattern: /\$\s?\d+(?:,\d{3})*(?:\.\d{2})?/g },
  { label: 'paid status', pattern: /\b(?:paid|payment\s*received|outstanding|overdue)\b/gi },
];

function normalizeMime(mimeType: string, filename: string): string {
  const lower = mimeType.toLowerCase().trim();
  if (lower && lower !== 'application/octet-stream') return lower;
  const ext = filename.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
  };
  return byExt[ext] || lower;
}

function extractStringsFromPdf(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const parts: string[] = [];
  const paren = /\((?:\\.|[^\\)]){2,200}\)/g;
  let match: RegExpExecArray | null;
  while ((match = paren.exec(raw))) {
    const inner = match[0]
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-z]{2,}/.test(inner)) parts.push(inner);
  }
  const hex = /<([0-9A-Fa-f\s]{8,})>/g;
  while ((match = hex.exec(raw))) {
    const hexBody = match[1]!.replace(/\s+/g, '');
    if (hexBody.length % 2 !== 0) continue;
    try {
      const decoded = Buffer.from(hexBody, 'hex').toString('utf8');
      if (/[A-Za-z]{3,}/.test(decoded)) parts.push(decoded);
    } catch {
      // ignore invalid hex
    }
  }
  return parts.join('\n');
}

async function extractTextFromDocx(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return '';
  return docXml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

async function extractTextFromXlsx(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const shared: string[] = [];
  if (sharedXml) {
    const si = sharedXml.match(/<si[\s\S]*?<\/si>/g) || [];
    for (const block of si) {
      const texts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] || '');
      shared.push(texts.join(''));
    }
  }
  const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  if (!sheet) return shared.join('\n');
  const cells: string[] = [];
  const cellRe = /<c[^>]*?(?:t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheet))) {
    const type = m[1];
    const value = m[2] ?? '';
    if (type === 's') {
      const idx = Number(value);
      const sharedValue = Number.isFinite(idx) ? shared[idx] : undefined;
      if (sharedValue) cells.push(sharedValue);
    } else if (value) {
      cells.push(value);
    }
  }
  return cells.join('\n');
}

function pickFirst(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function stripTransactionalNoise(text: string): { cleaned: string; stripped: string[] } {
  let cleaned = text;
  const stripped: string[] = [];
  for (const { label, pattern } of TRANSACTIONAL_PATTERNS) {
    if (pattern.test(cleaned)) {
      stripped.push(label);
      cleaned = cleaned.replace(pattern, ' ');
    }
    pattern.lastIndex = 0;
  }
  // Drop obvious line-item quantity rows (e.g. "2 x Widget 100.00")
  cleaned = cleaned.replace(/^\s*\d+(?:\.\d+)?\s*[x×]\s+.+$/gim, ' ');
  return { cleaned: cleaned.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), stripped: [...new Set(stripped)] };
}

function detectColorsFromText(text: string): Partial<InvoiceTemplateDesign['colors']> {
  const hexes = [...text.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => `#${m[1]!.toLowerCase()}`);
  const unique = [...new Set(hexes)];
  if (!unique.length) return {};
  const primary = unique[0];
  if (!primary) return {};
  const colors: Partial<InvoiceTemplateDesign['colors']> = {
    primary,
    accent: unique[1] || primary,
    secondary: unique[2] || '#e8f0ec',
  };
  return colors;
}

function samplePngColors(bytes: Buffer): Partial<InvoiceTemplateDesign['colors']> | null {
  if (bytes.length < 33 || bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  // Look for a PLTE chunk for palette-based PNGs; otherwise keep defaults.
  const plteIndex = bytes.indexOf(Buffer.from('PLTE'));
  if (plteIndex > 4 && plteIndex + 9 < bytes.length) {
    const r = bytes[plteIndex + 4];
    const g = bytes[plteIndex + 5];
    const b = bytes[plteIndex + 6];
    if (r === undefined || g === undefined || b === undefined) return null;
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    const primary = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    return { primary, accent: primary, secondary: '#f3f4f6' };
  }
  return null;
}

function detectElements(text: string, mimeType: string): string[] {
  const found = new Set<string>();
  if (/logo|brand/i.test(text) || mimeType.startsWith('image/')) found.add('logo');
  if (/abn|tax\s*id|gst\s*reg/i.test(text)) found.add('ABN');
  if (/@/.test(text)) found.add('email');
  if (/(?:tel|phone|ph)[:.\s]/i.test(text) || /\b0\d{9,10}\b/.test(text)) found.add('phone');
  if (/https?:\/\/|www\./i.test(text)) found.add('website');
  if (/tax\s*invoice|invoice/i.test(text)) found.add('invoice title');
  if (/bill\s*to|customer/i.test(text)) found.add('customer block');
  if (/description|qty|quantity|unit\s*price|amount/i.test(text)) found.add('line item table');
  if (/subtotal|total\s*due|amount\s*due/i.test(text)) found.add('totals section');
  if (/\bgst\b|tax\s*amount/i.test(text)) found.add('GST section');
  if (/bsb|account\s*number|payment\s*details|pay\s*to|bank/i.test(text)) found.add('payment details');
  if (/terms|conditions|payment\s*terms/i.test(text)) found.add('Terms & Conditions');
  if (/notes?|comments?/i.test(text)) found.add('notes');
  if (/footer|page\s*\d/i.test(text)) found.add('footer');
  if (/watermark/i.test(text)) found.add('watermarks');
  if (/qr\s*code|scan\s*to\s*pay/i.test(text)) found.add('QR codes');
  found.add('layout');
  found.add('colours');
  found.add('fonts');
  found.add('margins');
  return [...found];
}

function inferTypography(text: string): Partial<InvoiceTemplateDesign['typography']> {
  if (/serif|times|garamond|georgia/i.test(text)) {
    return { headingFont: 'Times-Bold', bodyFont: 'Times-Roman', titleSize: 20 };
  }
  if (/mono|courier|typewriter/i.test(text)) {
    return { headingFont: 'Courier', bodyFont: 'Courier', titleSize: 16 };
  }
  return { headingFont: 'Helvetica-Bold', bodyFont: 'Helvetica', titleSize: 18 };
}

function buildDesignFromText(
  text: string,
  mimeType: string,
  bytes: Buffer,
  filename: string,
): InvoiceTemplateDesign {
  const { cleaned, stripped } = stripTransactionalNoise(text);
  const companyNameRaw =
    pickFirst(
      [
        /(?:from|business|company|trading\s*as)\s*[:]\s*([^\n]{2,80})/i,
        /\b([A-Z][A-Za-z0-9&'’.-]{1,40}(?:\s+[A-Z][A-Za-z0-9&'’.-]{1,40}){0,4})\s+(?:TAX\s*INVOICE|INVOICE)\b/,
        /^([A-Z][A-Za-z0-9&'’. -]{2,60})\s*$/m,
      ],
      cleaned,
    ) ||
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .slice(0, 80) ||
    null;
  const companyName = companyNameRaw
    ? companyNameRaw.replace(/\b(?:TAX\s*INVOICE|INVOICE)\b/gi, '').trim() || companyNameRaw
    : null;

  const abnTaxId = pickFirst(
    [
      /\bABN[:\s]*([0-9]{2}\s*[0-9]{3}\s*[0-9]{3}\s*[0-9]{3})\b/i,
      /\bABN[:\s]*([0-9\s]{11,14})\b/i,
      /\bTax\s*ID[:\s]*([A-Z0-9-]{5,20})\b/i,
    ],
    cleaned,
  );
  const email = pickFirst([/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/], cleaned);
  const phone = pickFirst(
    [/(?:phone|tel|ph|mobile)[:\s]*([+0-9()[\]\-\s]{8,20})/i, /(\b0\d{1,2}\s?\d{4}\s?\d{4}\b)/],
    cleaned,
  );
  const website = pickFirst([/(https?:\/\/[^\s]+)/i, /(www\.[^\s]+)/i], cleaned);
  const address = pickFirst(
    [
      /(?:address|located\s*at)\s*[:]\s*([^\n]{8,160})/i,
      /(\d{1,5}\s+[A-Za-z].{8,100}(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*\d{4})/i,
    ],
    cleaned,
  );
  const paymentDetails = pickFirst(
    [
      /((?:BSB|Account|Pay\s*to|Bank)[\s\S]{0,220})/i,
      /(Payment\s*details[:\s][\s\S]{0,220})/i,
    ],
    cleaned,
  );
  const terms = pickFirst(
    [/(Terms(?:\s*&\s*Conditions)?[:\s][\s\S]{0,400})/i, /(Payment\s*terms[:\s][\s\S]{0,220})/i],
    cleaned,
  );
  const titleMatch = cleaned.match(/\b(TAX\s*INVOICE|INVOICE|TAX INVOICE)\b/i);
  const documentTitle = titleMatch?.[1]?.toUpperCase().replace(/\s+/g, ' ') || 'TAX INVOICE';

  const colorFromText = detectColorsFromText(cleaned);
  const colorFromPng = mimeType === 'image/png' ? samplePngColors(bytes) : null;
  const colors = { ...colorFromText, ...(colorFromPng || {}) };

  const isImage = mimeType.startsWith('image/');
  const logoDataUrl = isImage
    ? `data:${mimeType};base64,${bytes.toString('base64')}`
    : null;

  const notes: string[] = [
    `Analysed ${filename} (${mimeType}).`,
    'Transactional fields (customers, invoice numbers, dates, products, prices, paid status) were excluded.',
  ];
  if (stripped.length) notes.push(`Stripped signals: ${stripped.join(', ')}.`);
  if (!cleaned && isImage) {
    notes.push('Image upload used for logo/branding colours; text fields left for review.');
  }
  if (!process.env.OPENAI_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    notes.push('Heuristic analysis used (no AI gateway key configured).');
  }

  const base = defaultInvoiceTemplateDesign();
  return defaultInvoiceTemplateDesign({
    documentTitle,
    colors: { ...base.colors, ...colors },
    typography: { ...base.typography, ...inferTypography(cleaned) },
    businessDefaults: {
      companyName,
      legalName: companyName,
      abnTaxId,
      address,
      email,
      phone,
      website,
      logoDataUrl,
    },
    paymentDetails,
    termsAndConditions: terms,
    notesPlaceholder: 'Thank you for your business.',
    borders: {
      table: /line|qty|description|amount/i.test(cleaned),
      headerRule: true,
      width: 1,
    },
    watermark: /draft|copy|sample/i.test(cleaned)
      ? { text: 'SAMPLE', opacity: 0.08 }
      : null,
    analysisNotes: notes,
  });
}

async function extractText(mimeType: string, bytes: Buffer): Promise<string> {
  if (mimeType === 'application/pdf') return extractStringsFromPdf(bytes);
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    if (mimeType === 'application/msword') {
      return bytes
        .toString('utf8')
        .split('')
        .map((char) => {
          const code = char.charCodeAt(0);
          if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) {
            return char;
          }
          return ' ';
        })
        .join('')
        .replace(/\s+/g, ' ');
    }
    return extractTextFromDocx(bytes);
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return extractTextFromXlsx(bytes);
  }
  if (mimeType.startsWith('image/')) return '';
  return bytes.toString('utf8').slice(0, 50_000);
}

/**
 * Analyse an uploaded invoice document and return a design-only template.
 * Never imports customers, invoice numbers, dates, products, prices, or paid status.
 */
export async function analyzeInvoiceDocument(
  input: AnalyzeInvoiceDocumentInput,
): Promise<AnalyzeInvoiceDocumentResult> {
  const mimeType = normalizeMime(input.mimeType, input.filename);
  const allowed = SUPPORTED_IMPORT_MIME_TYPES as readonly string[];
  if (!allowed.includes(mimeType) && !mimeType.startsWith('image/')) {
    throw new Error('UNSUPPORTED_IMPORT_FORMAT');
  }
  if (input.bytes.length === 0) throw new Error('EMPTY_IMPORT_FILE');
  if (input.bytes.length > 4_500_000) throw new Error('IMPORT_FILE_TOO_LARGE');

  const text = await extractText(mimeType, input.bytes);
  const design = buildDesignFromText(text, mimeType, input.bytes, input.filename);
  const detectedElements = detectElements(text, mimeType);
  const { stripped } = stripTransactionalNoise(text);

  const confidenceBase = mimeType.startsWith('image/') ? 0.55 : 0.72;
  const fieldHits = [
    design.businessDefaults.companyName,
    design.businessDefaults.abnTaxId,
    design.businessDefaults.email,
    design.businessDefaults.address,
    design.paymentDetails,
  ].filter(Boolean).length;
  const confidence = Math.min(0.95, confidenceBase + fieldHits * 0.04);

  return {
    design,
    extractedTextPreview: text.slice(0, 1200),
    detectedElements,
    strippedTransactionalFields: stripped,
    confidence,
  };
}

export function isSupportedImportMime(mimeType: string, filename: string): boolean {
  const normalized = normalizeMime(mimeType, filename);
  return (SUPPORTED_IMPORT_MIME_TYPES as readonly string[]).includes(normalized);
}
