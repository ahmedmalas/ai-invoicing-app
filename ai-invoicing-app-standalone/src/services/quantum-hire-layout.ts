/**
 * Measured geometry from Cart N Tip #107 / Quantum Hire reference PDF
 * (ReportLab A4). Coordinates use PDFKit / PyMuPDF top-left origin (pt).
 *
 * This is the visual source of truth for the quantum-hire renderer.
 * Do not replace these with Aleya PDF_PAGE_MARGIN or template margin guesses.
 */
export const QH = {
  page: { width: 595.276, height: 841.89 },

  /** Near-bleed content edge used by the reference. */
  left: 12,
  right: 594,
  contentWidth: 582,

  logo: { x: 34, y: 29.56, width: 178, height: 118.66 },

  headerDivider: { x: 276, y0: 31.89, y1: 168.89 },
  headerRule: { y: 193.89, x0: 12, x1: 542 },

  title: { x: 320, y: 30.9, size: 29 },
  meta: {
    labelX: 320,
    valueRight: 505,
    width: 185,
    firstY: 95.4,
    rowStep: 25,
    labelSize: 9.8,
    valueSize: 10,
  },

  billTo: { x: 12, y: 223.1, labelSize: 11 },
  from: { x: 292, y: 223.1, labelSize: 11 },
  partyName: { y: 256.1, size: 8.2 },
  fromDetail: { firstY: 284.5, step: 29, size: 8.7 },

  /** Reference places the table here when the party block is short. */
  table: {
    top: 411.89,
    headerHeight: 31,
    rowHeight: 30,
    outerLeft: 12,
    outerRight: 594,
    /** Vertical grid lines (inner). */
    colLines: [100, 320, 382, 476],
    /** Text anchors (≈10pt inset from each cell left). */
    textX: {
      date: 22,
      description: 110,
      qty: 330,
      rate: 392,
      amount: 486,
    },
    headerTextYOffset: 10.9,
    bodyTextYOffset: 6.6,
    headerFontSize: 8.5,
    bodyFontSize: 8.7,
    gridColor: '#e1e1e1',
    ruleColor: '#cfcfcf',
  },

  footer: {
    ruleYGap: 24,
    ruleX1: 542,
    dividerX: 276,
    dividerTopGap: 17,
    dividerHeight: 124,
    paymentTitleYGap: 23,
    paymentTitleSize: 9.5,
    paymentLabelSize: 6.8,
    paymentValueSize: 7,
    paymentValueX: 97,
    paymentRowStep: 21,
    noteTitleSize: 7,
    noteBodySize: 6.2,
    noteLineGap: 14,
    totalsX: 320,
    totalsValueRight: 535,
    totalsLabelSize: 8.2,
    totalsRowStep: 31,
    totalLabelSize: 9,
    totalAmountSize: 22,
    totalRuleX0: 320,
    totalRuleX1: 535,
    thankYou: { x: 378.8, yOffsetFromDividerTop: 126, width: 110.4, height: 46 },
  },
} as const;

export type QuantumHireColumnId = 'date' | 'description' | 'qty' | 'rate' | 'amount';

export function quantumHireColumnBounds(): Record<
  QuantumHireColumnId,
  { x0: number; x1: number; textX: number; width: number }
> {
  const lefts = [QH.table.outerLeft, ...QH.table.colLines, QH.table.outerRight];
  const ids: QuantumHireColumnId[] = ['date', 'description', 'qty', 'rate', 'amount'];
  const out = {} as Record<
    QuantumHireColumnId,
    { x0: number; x1: number; textX: number; width: number }
  >;
  ids.forEach((id, index) => {
    const x0 = lefts[index]!;
    const x1 = lefts[index + 1]!;
    out[id] = {
      x0,
      x1,
      textX: QH.table.textX[id],
      width: x1 - x0,
    };
  });
  return out;
}
