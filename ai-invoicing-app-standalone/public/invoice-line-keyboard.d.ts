export const LINE_FIELD_ORDER: readonly [
  'description',
  'quantity',
  'unitPrice',
  'gstApplicable',
];

export function displayLineNumber(visibleRowIndex: number): number;

export function formatLineItemCountLabel(count: number): string;

export function createLineClientKey(): string;

export function ensureLineClientKeys<T extends Record<string, unknown>>(
  lineItems?: T[] | null,
): Array<T & { clientKey: string }>;

export function normalizeNumericText(raw: unknown): string;

export function parseLineNumericInput(raw: unknown, previous?: number): number;

export function blankLineItem(): {
  clientKey: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
};

export function parseSpreadsheetPaste(text: unknown): string[][];

export function applyLinePaste(input?: {
  lineItems?: Array<Record<string, unknown>>;
  startIndex?: number;
  startField?: string;
  pastedText?: string;
}): {
  handled: boolean;
  lineItems: Array<Record<string, unknown> & { clientKey: string }>;
  focus: { lineIndex: number; field: string } | null;
  rowsTouched: number[];
};

export function resolveEnterNavigation(input: {
  field: string;
  lineIndex: number;
  lineCount: number;
}): { action: 'focus' | 'add-row'; field: string; lineIndex: number };

export function resolveTabNavigation(input: {
  field: string;
  lineIndex: number;
  lineCount: number;
  shiftKey: boolean;
}): { action: 'focus' | 'add-row' | 'native'; field?: string; lineIndex?: number };

export function shouldHandleLineEnter(target: {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
} | null): boolean;

export function shouldHandleLineTab(target: {
  getAttribute?: (name: string) => string | null;
} | null): boolean;

export function shouldHandleLinePaste(
  target: {
    getAttribute?: (name: string) => string | null;
  } | null,
  pastedText?: string,
): boolean;
