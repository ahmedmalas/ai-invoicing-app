const PASSWORD_SELECTOR = 'input[type="password"]';

function enhancePasswordInput(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.visibilityReady === 'true') return;

  input.dataset.visibilityReady = 'true';
  const wrapper = document.createElement('span');
  wrapper.className = 'password-field';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.append(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.setAttribute('aria-label', 'Show password');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<span aria-hidden="true">&#128065;</span>';
  button.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    button.setAttribute('aria-pressed', showing ? 'false' : 'true');
  });

  wrapper.append(button);
}

function enhancePasswordInputs(root = document) {
  root.querySelectorAll?.(PASSWORD_SELECTOR).forEach(enhancePasswordInput);
}

enhancePasswordInputs();
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(PASSWORD_SELECTOR)) enhancePasswordInput(node);
      enhancePasswordInputs(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
