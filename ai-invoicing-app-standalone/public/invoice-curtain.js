/** Full-screen invoice curtain open/close — hardware-accelerated via WAAPI. */

export const INVOICE_CURTAIN_DURATION_MS = 360;

const OPEN_KEYFRAMES = [
  { transform: 'translate3d(0, -100%, 0)' },
  { transform: 'translate3d(0, 0, 0)' },
];
const CLOSE_KEYFRAMES = [
  { transform: 'translate3d(0, 0, 0)' },
  { transform: 'translate3d(0, -100%, 0)' },
];
const TIMING = {
  duration: INVOICE_CURTAIN_DURATION_MS,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  fill: 'forwards',
};

function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function cancelCurtainAnimations(curtain) {
  if (typeof curtain.getAnimations !== 'function') return;
  for (const animation of curtain.getAnimations()) animation.cancel();
}

/**
 * Force the closed class state to paint before opening.
 * Do not set element.style — production CSP style-src blocks inline styles.
 */
export function prepareCurtainClosedFrame(curtain) {
  if (!curtain) return;
  cancelCurtainAnimations(curtain);
  curtain.classList.remove('is-open', 'is-closing');
  curtain.setAttribute('data-curtain-state', 'closed');
  curtain.setAttribute('aria-hidden', 'true');
  void curtain.getBoundingClientRect();
}

/**
 * Open: top → bottom.
 * Uses Web Animations API so routing/mount cannot coalesce away a CSS transition.
 */
export function openInvoiceCurtain(curtain, { onOpened } = {}) {
  if (!curtain) return Promise.resolve(false);
  prepareCurtainClosedFrame(curtain);

  const finishOpen = () => {
    curtain.classList.add('is-open');
    curtain.classList.remove('is-closing');
    curtain.setAttribute('data-curtain-state', 'open');
    curtain.setAttribute('aria-hidden', 'false');
    onOpened?.();
  };

  if (prefersReducedMotion() || typeof curtain.animate !== 'function') {
    finishOpen();
    return Promise.resolve(true);
  }

  curtain.setAttribute('data-curtain-state', 'opening');
  const animation = curtain.animate(OPEN_KEYFRAMES, TIMING);
  animation.id = 'invoice-curtain-open';
  return animation.finished.then(
    () => {
      finishOpen();
      return true;
    },
    () => {
      finishOpen();
      return true;
    },
  );
}

/** Close: bottom → top (retracts upward). */
export function closeInvoiceCurtain(curtain, { animate = true } = {}) {
  if (!curtain) return Promise.resolve(true);

  const remove = () => {
    cancelCurtainAnimations(curtain);
    curtain.classList.remove('is-open', 'is-closing');
    curtain.setAttribute('data-curtain-state', 'closed');
    curtain.setAttribute('aria-hidden', 'true');
    curtain.remove();
  };

  if (
    !animate ||
    prefersReducedMotion() ||
    typeof curtain.animate !== 'function' ||
    !(curtain.classList.contains('is-open') || curtain.getAttribute('data-curtain-state') === 'open')
  ) {
    remove();
    return Promise.resolve(true);
  }

  curtain.setAttribute('data-curtain-state', 'closing');
  curtain.setAttribute('aria-hidden', 'true');
  curtain.classList.add('is-closing');
  curtain.classList.remove('is-open');
  void curtain.getBoundingClientRect();

  const animation = curtain.animate(CLOSE_KEYFRAMES, TIMING);
  animation.id = 'invoice-curtain-close';
  return animation.finished.then(
    () => {
      remove();
      return true;
    },
    () => {
      remove();
      return true;
    },
  );
}
