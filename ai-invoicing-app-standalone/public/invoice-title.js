/**
 * Canonical invoice title binding.
 *
 * The visible header control and the submitted `title` value must never diverge.
 * FormData omits disabled controls, so payload collection must read live field
 * values (and sync any contenteditable mirror) instead of relying on FormData alone.
 */

function resolveElement(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function readControlText(control) {
  if (!control) return '';
  if (control.isContentEditable) return String(control.textContent || '');
  if (typeof control.value === 'string') return control.value;
  return String(control.textContent || '');
}

function writeControlText(control, value) {
  if (!control) return;
  const next = String(value ?? '');
  if (control.isContentEditable) {
    if (control.textContent !== next) control.textContent = next;
    return;
  }
  if ('value' in control && control.value !== next) control.value = next;
}

/** All controls that may represent the invoice header title. */
export function listInvoiceTitleControls(form) {
  if (!form?.querySelectorAll) return [];
  const seen = new Set();
  const controls = [];
  for (const control of form.querySelectorAll(
    '[name="title"], [data-invoice-title], [data-invoice-title-display]',
  )) {
    if (seen.has(control)) continue;
    seen.add(control);
    controls.push(control);
  }
  return controls;
}

/**
 * Pick the non-whitespace title the user can see / is editing, then write it
 * into every canonical `name="title"` control before payload collection.
 */
export function syncCanonicalInvoiceTitle(form) {
  const controls = listInvoiceTitleControls(form);
  if (!controls.length) {
    const field = form?.querySelector?.('[name="title"], [data-invoice-title]');
    return String(readControlText(field)).trim();
  }

  const active = resolveElement(form.ownerDocument?.activeElement);
  let visible = '';

  if (active && form.contains?.(active) && controls.includes(active)) {
    visible = readControlText(active);
  }

  if (!String(visible).trim()) {
    for (const control of controls) {
      const text = readControlText(control);
      if (String(text).trim()) {
        visible = text;
        break;
      }
    }
  }

  const canonical = String(visible ?? '');
  for (const control of controls) {
    // Keep every mirror (including hidden/disabled duplicates) identical.
    writeControlText(control, canonical);
  }
  return canonical.trim();
}

/** Read the canonical trimmed title after synchronising mirrors. */
export function readCanonicalInvoiceTitle(form) {
  return syncCanonicalInvoiceTitle(form);
}

/**
 * Read a named form control value without FormData, so disabled fields still count.
 * When duplicates exist, prefer the last non-whitespace value.
 */
export function readNamedFormValue(form, name) {
  if (!form || !name) return '';
  if (name === 'title') return readCanonicalInvoiceTitle(form);
  const fields = [...form.querySelectorAll(`[name="${name}"]`)];
  let value = '';
  for (const field of fields) {
    const next = String(field?.value ?? '');
    if (next.trim()) value = next;
    else if (!value) value = next;
  }
  return value;
}
