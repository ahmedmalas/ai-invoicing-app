export const CLIPBOARD_TSV_HEADERS: readonly string[];

export function serializeLineForClipboard(item?: Record<string, unknown>): {
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
};

export function cloneLineItem(item?: Record<string, unknown>): {
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
  clientKey: string;
};

export function cloneLineItems(
  items?: Array<Record<string, unknown>>,
): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
  clientKey: string;
}>;

export function formatSelectedCountLabel(count: number): string;

export function parseGstClipboardValue(
  raw: unknown,
  previous?: boolean,
): { ok: boolean; value: boolean; error?: string };

export function formatLinesAsTsv(items?: Array<Record<string, unknown>>): string;

export function parseClipboardRows(text: unknown): {
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    gstApplicable: boolean;
    clientKey: string;
  }>;
  errors: Array<{ row: number; message: string }>;
};

export function resolveRowSelection(input?: {
  selectedIndexes?: number[];
  clickedIndex?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  anchorIndex?: number | null;
  lineCount?: number;
}): { selectedIndexes: number[]; anchorIndex: number };

export function resolveSelectAll(input?: {
  lineCount?: number;
  currentlySelectedCount?: number;
}): number[];

export function insertLinesAfter(input?: {
  lineItems?: Array<Record<string, unknown>>;
  insertAfterIndex?: number;
  newLines?: Array<Record<string, unknown>>;
}): {
  lineItems: Array<Record<string, unknown> & { clientKey: string }>;
  insertedIndexes: number[];
  insertedClientKeys: string[];
};

export function linesFromSelectedIndexes(
  lineItems?: Array<Record<string, unknown>>,
  selectedIndexes?: number[],
): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
}>;

export function isMultiRowClipboardText(text?: string): boolean;

export function shouldInsertClipboardAsRows(text?: string, target?: { tagName?: string; closest?: (selector: string) => unknown } | null): boolean;

export function serializeNaturalSelection(
  selection: {
    isCollapsed?: boolean;
    containsNode?: (node: unknown, allowPartial?: boolean) => boolean;
    anchorNode?: unknown;
    focusNode?: unknown;
  } | null,
  root?: ParentNode | null,
): string | null;

export function blankSelectableLine(): {
  clientKey: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
};
