/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  INVOICE_CURTAIN_DURATION_MS,
  closeInvoiceCurtain,
  openInvoiceCurtain,
  prepareCurtainClosedFrame,
} from '../../public/invoice-curtain.js';

function stubAnimate(element, { finishImmediately = false } = {}) {
  const finished = finishImmediately
    ? Promise.resolve()
    : new Promise((resolve) => {
        element.__resolveAnimation = resolve;
      });
  element.animate = vi.fn(() => ({
    id: '',
    finished,
    cancel: vi.fn(),
  }));
  element.getAnimations = vi.fn(() => []);
}

describe('invoice curtain animation helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps duration in the perceptible 250–400ms band', () => {
    expect(INVOICE_CURTAIN_DURATION_MS).toBeGreaterThanOrEqual(250);
    expect(INVOICE_CURTAIN_DURATION_MS).toBeLessThanOrEqual(400);
  });

  it('forces a closed frame then animates open with WAAPI keyframes', async () => {
    const curtain = document.createElement('div');
    curtain.className = 'invoice-curtain';
    document.body.append(curtain);
    stubAnimate(curtain);
    const rect = vi.spyOn(curtain, 'getBoundingClientRect');

    prepareCurtainClosedFrame(curtain);
    expect(curtain.getAttribute('data-curtain-state')).toBe('closed');
    expect(curtain.classList.contains('is-open')).toBe(false);
    expect(rect).toHaveBeenCalled();

    const opened = openInvoiceCurtain(curtain);
    expect(curtain.getAttribute('data-curtain-state')).toBe('opening');
    expect(curtain.animate).toHaveBeenCalledWith(
      [
        { transform: 'translate3d(0, -100%, 0)' },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      expect.objectContaining({ duration: INVOICE_CURTAIN_DURATION_MS, fill: 'forwards' }),
    );
    expect(curtain.classList.contains('is-open')).toBe(false);

    curtain.__resolveAnimation();
    await opened;
    expect(curtain.classList.contains('is-open')).toBe(true);
    expect(curtain.getAttribute('data-curtain-state')).toBe('open');
  });

  it('closes by animating upward then removing the node', async () => {
    const curtain = document.createElement('div');
    curtain.className = 'invoice-curtain is-open';
    document.body.append(curtain);
    stubAnimate(curtain);
    vi.spyOn(curtain, 'getBoundingClientRect').mockReturnValue(new DOMRect());

    const closing = closeInvoiceCurtain(curtain, { animate: true });
    expect(curtain.classList.contains('is-closing')).toBe(true);
    expect(curtain.animate).toHaveBeenCalledWith(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(0, -100%, 0)' },
      ],
      expect.objectContaining({ duration: INVOICE_CURTAIN_DURATION_MS }),
    );

    curtain.__resolveAnimation();
    await closing;
    expect(document.body.contains(curtain)).toBe(false);
  });
});
