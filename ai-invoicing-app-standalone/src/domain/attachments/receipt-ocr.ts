import type { ReceiptOcrResult } from './types.js';

function pick(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Heuristic receipt field extraction from plain text (PDF/TXT/OCR pipeline).
 * Returns editable fields — never auto-commits without user review.
 */
export function extractReceiptFields(text: string): ReceiptOcrResult {
  const normalized = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const merchant =
    pick(
      [
        /(?:merchant|store|vendor|from)\s*[:]\s*([^\n]{2,80})/i,
        /^([A-Z][A-Za-z0-9&'’. -]{2,60})\s*$/m,
      ],
      normalized,
    ) || null;

  const date =
    pick(
      [
        /(?:date|purchased|issued)\s*[:]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
        /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
        /\b(\d{4}-\d{2}-\d{2})\b/,
      ],
      normalized,
    ) || null;

  const totalRaw = pick(
    [
      /(?:total\s*(?:amount|due)?|amount\s*due|grand\s*total)\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i,
      /\$\s*([\d,]+\.\d{2})\s*(?:total)?/i,
    ],
    normalized,
  );
  const gstRaw = pick(
    [/(?:gst|tax)\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i, /(?:gst|tax)\s+([\d,]+\.\d{2})/i],
    normalized,
  );
  const invoiceNumber =
    pick(
      [
        /(?:invoice|receipt)\s*(?:no|number|#)\s*[:#]?\s*([A-Z0-9-]{3,40})/i,
        /\bINV[- ]?([A-Z0-9-]{3,40})\b/i,
      ],
      normalized,
    ) || null;
  const referenceNumber =
    pick(
      [
        /(?:ref(?:erence)?|txn|transaction)\s*(?:no|number|#)?\s*[:#]?\s*([A-Z0-9-]{3,40})/i,
      ],
      normalized,
    ) || null;

  const total = parseMoney(totalRaw);
  const gst = parseMoney(gstRaw);
  const hits = [merchant, date, total, gst, invoiceNumber, referenceNumber].filter(
    (value) => value !== null && value !== undefined,
  ).length;

  return {
    merchant,
    date,
    total,
    gst,
    invoiceNumber,
    referenceNumber,
    confidence: Math.min(0.92, 0.35 + hits * 0.1),
    rawTextPreview: normalized.slice(0, 1200),
  };
}

export async function extractTextForReceiptOcr(
  mimeType: string,
  bytes: Buffer,
): Promise<string> {
  if (mimeType === 'text/plain') {
    return bytes.toString('utf8').slice(0, 50_000);
  }
  if (mimeType === 'application/pdf') {
    const raw = bytes.toString('latin1');
    const parts: string[] = [];
    const paren = /\((?:\\.|[^\\)]){2,200}\)/g;
    let match: RegExpExecArray | null;
    while ((match = paren.exec(raw))) {
      const inner = match[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[A-Za-z0-9]{2,}/.test(inner)) parts.push(inner);
    }
    return parts.join('\n');
  }
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return '';
    return docXml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // Images: text OCR requires an external vision service; return empty for review UI.
  return '';
}
