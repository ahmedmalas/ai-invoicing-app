const PASSWORD_SELECTOR = 'input[type="password"], input[data-password-input="true"]';

const EYE_OPEN =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.27 2 2 3.27l2.2 2.2C2.82 6.78 1.7 8.28 1 10c1.73 3.89 6 7 11 7 1.6 0 3.12-.31 4.5-.86L20.73 21 22 19.73 3.27 2zM12 15a5 5 0 0 1-5-5c0-.7.15-1.36.4-1.96l6.56 6.56c-.6.25-1.26.4-1.96.4zm8.6-1.14-2.12-2.12c.33-.55.52-1.2.52-1.9a5 5 0 0 0-5-5c-.7 0-1.35.19-1.9.52L9.98 3.24C10.63 3.08 11.3 3 12 3c5 0 9.27 3.11 11 7-.5 1.13-1.25 2.15-2.2 3.02z"/></svg>';

function enhancePasswordInput(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.visibilityReady === 'true') return;
  if (input.type !== 'password' && input.dataset.passwordInput !== 'true') return;

  input.dataset.visibilityReady = 'true';
  input.dataset.passwordInput = 'true';
  const wrapper = document.createElement('span');
  wrapper.className = 'password-field';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.append(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.setAttribute('aria-label', 'Show password');
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('title', 'Show password');
  button.innerHTML = EYE_OPEN;

  const sync = () => {
    const showing = input.type === 'text';
    button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    button.setAttribute('title', showing ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', showing ? 'true' : 'false');
    button.innerHTML = showing ? EYE_OFF : EYE_OPEN;
  };

  button.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    sync();
    input.focus();
  });

  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
    }
  });

  wrapper.append(button);
  sync();
}

function enhancePasswordInputs(root = document) {
  root.querySelectorAll?.(PASSWORD_SELECTOR).forEach(enhancePasswordInput);
}

enhancePasswordInputs();
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(PASSWORD_SELECTOR)) enhancePasswordInput(node);
      enhancePasswordInputs(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
