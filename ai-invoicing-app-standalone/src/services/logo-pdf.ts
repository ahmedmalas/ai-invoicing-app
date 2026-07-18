import type PDFDocument from 'pdfkit';

import { decodeLogoReference, type LogoConcept } from '../domain/logos/logo-studio.js';
import type { BrandingProfile } from '../types/entities.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

function fillShape(
  doc: PdfDoc,
  shape: LogoConcept['markShape'],
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  doc.fillColor(color);
  switch (shape) {
    case 'circle':
      doc.circle(cx, cy, r).fill();
      break;
    case 'rounded-square': {
      const s = r * 1.7;
      doc.roundedRect(cx - s / 2, cy - s / 2, s, s, s * 0.22).fill();
      break;
    }
    case 'hex': {
      const points: Array<[number, number]> = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      });
      doc.moveTo(points[0]![0], points[0]![1]);
      for (const [x, y] of points.slice(1)) doc.lineTo(x, y);
      doc.closePath().fill();
      break;
    }
    case 'shield':
      doc
        .moveTo(cx, cy - r)
        .lineTo(cx + r * 0.9, cy - r * 0.55)
        .lineTo(cx + r * 0.9, cy + r * 0.15)
        .quadraticCurveTo(cx + r * 0.9, cy + r * 0.7, cx, cy + r)
        .quadraticCurveTo(cx - r * 0.9, cy + r * 0.7, cx - r * 0.9, cy + r * 0.15)
        .lineTo(cx - r * 0.9, cy - r * 0.55)
        .closePath()
        .fill();
      break;
    case 'pill':
      doc.roundedRect(cx - r * 1.2, cy - r * 0.75, r * 2.4, r * 1.5, r * 0.75).fill();
      break;
  }
}

/** Draw the active Aleya logo mark into a PDF document. Returns occupied height. */
export function drawBusinessLogoMark(
  doc: PdfDoc,
  profile: BrandingProfile | null,
  x = 48,
  y = 48,
  size = 44,
): number {
  const concept = decodeLogoReference(profile?.logoReference);
  if (!concept) return 0;

  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.42;
  fillShape(doc, concept.markShape, cx, cy, r, concept.primaryColor);
  doc
    .fillColor(concept.secondaryColor)
    .fontSize(size * 0.38)
    .font('Helvetica-Bold')
    .text(concept.monogram, x, cy - size * 0.18, {
      width: size,
      align: 'center',
      lineBreak: false,
    });
  return size + 8;
}

export function resolveActiveLogoConcept(profile: BrandingProfile | null): LogoConcept | null {
  return decodeLogoReference(profile?.logoReference);
}
