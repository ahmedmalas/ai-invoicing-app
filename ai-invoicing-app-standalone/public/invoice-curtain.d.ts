export const INVOICE_CURTAIN_DURATION_MS: number;
export function prepareCurtainClosedFrame(curtain: Element | null | undefined): void;
export function openInvoiceCurtain(
  curtain: Element | null | undefined,
  options?: { onOpened?: () => void },
): Promise<boolean>;
export function closeInvoiceCurtain(
  curtain: Element | null | undefined,
  options?: { animate?: boolean },
): Promise<boolean>;
