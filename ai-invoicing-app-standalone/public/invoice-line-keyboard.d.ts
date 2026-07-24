export const LINE_FIELD_ORDER: readonly [
  'description',
  'quantity',
  'unitPrice',
  'gstApplicable',
];

export function createLineClientKey(): string;

export function ensureLineClientKeys<T extends Record<string, unknown>>(
  lineItems?: T[] | null,
): Array<T & { clientKey: string }>;

export function parseLineNumericInput(raw: unknown, previous?: number): number;

export function blankLineItem(): {
  clientKey: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
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
