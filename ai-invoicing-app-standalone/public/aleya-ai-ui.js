/**
 * Aleya AI workspace — natural-language assistant UI.
 * Talks to /api/aleya-ai/* and refreshes app caches from tool UI instructions.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function visibleStateFromApp(deps) {
  const path = location.pathname;
  const invoiceMatch = path.match(/\/workspace\/invoices\/([^/]+)/);
  return {
    currentPath: path,
    activeInvoiceId: invoiceMatch?.[1] && invoiceMatch[1] !== 'new' ? invoiceMatch[1] : null,
    activeCustomerId: null,
    activeTemplateId: null,
    selectedInvoiceIds: [],
    ...(deps.getVisibleState?.() || {}),
  };
}

function humanToolLine(toolCall) {
  const name = toolCall?.toolName || 'tool';
  const result = toolCall?.result;
  if (!result) return name;
  if (result.ok) return '✓ ' + name + ' — ' + (result.summary || 'ok');
  if (result.needsConfirmation) return '⏳ ' + name + ' — confirmation required';
  return '✗ ' + name + ' — ' + (result.message || 'failed');
}

export function createAleyaAiUi(deps) {
  let conversationId = null;
  let pendingConfirmation = null;
  let busy = false;
  let lastFocusInvoiceId = null;
  let abortController = null;

  function renderMessage(role, content, options = {}) {
    const extraClass = options.kind ? ' aleya-msg-' + options.kind : '';
    return (
      '<div class="aleya-msg aleya-msg-' +
      escapeHtml(role) +
      extraClass +
      '"><div class="aleya-msg-role">' +
      (role === 'user' ? 'You' : options.label || 'Aleya AI') +
      '</div><div class="aleya-msg-body">' +
      escapeHtml(content).replaceAll('\n', '<br>') +
      '</div></div>'
    );
  }

  async function aleyaAiPage() {
    // Paint shell immediately; load a concise capability catalog in parallel.
    const modelReadyPlaceholder = true;
    deps.shell(
      '<main class="page aleya-ai-page">' +
        deps.pageHead(
          'Aleya AI',
          'Natural-language assistant',
          'Ask in ordinary language. Aleya uses registered tools for what it can access, and says clearly when a feature is missing or not yet wired.',
        ) +
        '<section class="aleya-ai-layout">' +
        '<div class="aleya-ai-panel">' +
        '<div class="aleya-ai-meta muted" data-aleya-meta>Loading capability catalog…</div>' +
        '<div class="aleya-ai-thread" data-aleya-thread>' +
        renderMessage(
          'assistant',
          'Ask a question whenever you are ready. Simple status questions are answered directly; invoice work uses registered tools.',
        ) +
        '</div>' +
        '<div class="aleya-ai-confirm" data-aleya-confirm hidden></div>' +
        '<form class="aleya-ai-composer" data-aleya-form>' +
        '<textarea name="message" rows="3" placeholder="e.g. Is my bank feed connected? Which invoices are still unpaid?" required></textarea>' +
        '<div class="aleya-ai-actions">' +
        '<button type="submit" class="button" data-aleya-send>Send</button>' +
        '<button type="button" class="button secondary" data-aleya-cancel hidden>Cancel</button>' +
        '<button type="button" class="button secondary" data-aleya-confirm-btn hidden>Confirm and continue</button>' +
        '<a class="button secondary" data-aleya-open-invoice hidden href="#">Open invoice</a>' +
        '</div></form></div>' +
        '<aside class="aleya-ai-side">' +
        '<h2>What I can access</h2>' +
        '<ul class="aleya-ai-tool-list" data-aleya-tool-list><li class="muted">Loading…</li></ul>' +
        '<p class="muted">Tool schemas stay on the server. This list is a concise catalog, not full application data.</p>' +
        '</aside></section></main>',
    );

    const thread = document.querySelector('[data-aleya-thread]');
    const form = document.querySelector('[data-aleya-form]');
    const confirmBox = document.querySelector('[data-aleya-confirm]');
    const confirmBtn = document.querySelector('[data-aleya-confirm-btn]');
    const cancelBtn = document.querySelector('[data-aleya-cancel]');
    const openInvoiceBtn = document.querySelector('[data-aleya-open-invoice]');
    const metaEl = document.querySelector('[data-aleya-meta]');
    const toolListEl = document.querySelector('[data-aleya-tool-list]');
    let modelReady = modelReadyPlaceholder;

    // Non-blocking catalog fetch — chat input is already usable.
    void deps
      .api('/api/aleya-ai/capabilities')
      .then((caps) => {
        modelReady = Boolean(caps.providerConfigured);
        const modelLabel = caps.model || 'openai/gpt-5.4';
        const authLabel =
          caps.authMethod && caps.authMethod !== 'none' ? caps.authMethod : 'unconfigured';
        if (metaEl) {
          metaEl.textContent =
            String(caps.toolCount || 0) +
            ' registered tools · ' +
            (modelReady
              ? 'model ready (' + modelLabel + ' via ' + authLabel + ')'
              : 'model connection not configured') +
            ' · expanding coverage (not a complete operating layer yet)';
        }
        if (toolListEl) {
          const controllable = (caps.productCapabilities || []).filter(
            (item) => item.aiAccess && item.aiAccess !== 'none',
          );
          const missing = (caps.productCapabilities || []).filter(
            (item) => item.appExists === 'no',
          );
          toolListEl.innerHTML =
            controllable
              .slice(0, 20)
              .map(
                (item) =>
                  '<li><strong>' +
                  escapeHtml(item.label) +
                  '</strong><span>' +
                  escapeHtml(item.aiAccess) +
                  (item.appExists === 'partial' ? ' · partial app' : '') +
                  '</span></li>',
              )
              .join('') +
            (missing.length
              ? '<li class="muted"><strong>Not in product yet</strong><span>' +
                escapeHtml(missing.map((item) => item.label).join(', ')) +
                '</span></li>'
              : '');
        }
        const sendBtn = form?.querySelector('[data-aleya-send]');
        if (sendBtn && !modelReady) {
          sendBtn.disabled = true;
          sendBtn.title = 'Model provider not configured';
        }
      })
      .catch(() => {
        if (metaEl) metaEl.textContent = 'Capability catalog unavailable — chat may still work.';
      });

    function append(role, content, options) {
      if (!thread) return;
      thread.insertAdjacentHTML('beforeend', renderMessage(role, content, options));
      thread.scrollTop = thread.scrollHeight;
    }

    function setOpenInvoice(invoiceId) {
      lastFocusInvoiceId = invoiceId || null;
      if (!openInvoiceBtn) return;
      if (!invoiceId) {
        openInvoiceBtn.hidden = true;
        openInvoiceBtn.removeAttribute('href');
        return;
      }
      openInvoiceBtn.hidden = false;
      openInvoiceBtn.setAttribute(
        'href',
        '/workspace/invoices/' + encodeURIComponent(invoiceId) + '/edit',
      );
    }

    function showConfirm(pending) {
      pendingConfirmation = pending;
      if (!confirmBox || !confirmBtn) return;
      if (!pending) {
        confirmBox.hidden = true;
        confirmBtn.hidden = true;
        confirmBox.innerHTML = '';
        return;
      }
      confirmBox.hidden = false;
      confirmBtn.hidden = false;
      confirmBox.innerHTML =
        '<strong>Confirmation required</strong><p>' +
        escapeHtml(pending.summary) +
        '</p><p class="muted">One confirmation covers this high-impact step in the current workflow.</p>';
    }

    async function send(message, { confirm = false } = {}) {
      if (busy) return;
      if (!modelReady && !confirm) {
        // Still allow status questions — server may answer via capability fast-path.
      }
      busy = true;
      abortController = new AbortController();
      form?.querySelectorAll('button').forEach((button) => {
        if (button !== cancelBtn) button.disabled = true;
      });
      if (cancelBtn) cancelBtn.hidden = false;
      let progressEl = null;
      try {
        if (!confirm) append('user', message);
        append('assistant', 'Working…', {
          kind: 'progress',
          label: 'Progress',
        });
        progressEl = thread?.lastElementChild || null;

        const result = await deps.api('/api/aleya-ai/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: confirm ? 'Confirmed. Continue the approved workflow.' : message,
            conversationId,
            visibleState: visibleStateFromApp(deps),
            confirm,
            confirmationToken: confirm ? pendingConfirmation?.token : undefined,
          }),
          signal: abortController.signal,
        });
        if (progressEl) progressEl.remove();

        conversationId = result.conversationId;

        if (Array.isArray(result.toolCalls) && result.toolCalls.length) {
          append(
            'assistant',
            'Tool progress:\n' + result.toolCalls.map(humanToolLine).join('\n'),
            { kind: 'progress', label: 'Tools' },
          );
        }

        const finalText = result.assistantMessage || (result.error ? result.error.message : 'Done.');
        append('assistant', finalText, result.error ? { kind: 'error' } : undefined);
        showConfirm(result.pendingConfirmation || null);

        if (result.ui?.focusInvoiceId) {
          setOpenInvoice(result.ui.focusInvoiceId);
        }
        if (result.ui?.refresh?.includes('invoices') || result.ui?.refresh?.includes('customers')) {
          deps.invalidateCache?.();
        }
        // Avoid dumping decision noise for simple status answers.
        if (result.decisions?.length && result.path !== 'status_fast_path') {
          append('assistant', 'Decisions:\n- ' + result.decisions.join('\n- '), {
            kind: 'progress',
            label: 'Decisions',
          });
        }
        if (result.error) {
          deps.toast?.(result.error.message || 'Aleya AI step failed', true);
        }
      } catch (error) {
        if (progressEl) progressEl.remove();
        if (error?.name === 'AbortError') {
          append('assistant', 'Request cancelled.', { kind: 'error' });
        } else {
          append('assistant', error.message || 'Request failed.', { kind: 'error' });
          deps.toast?.(error.message || 'Aleya AI request failed', true);
        }
      } finally {
        busy = false;
        abortController = null;
        form?.querySelectorAll('button').forEach((button) => {
          button.disabled = false;
        });
        if (cancelBtn) cancelBtn.hidden = true;
        const sendBtn = form?.querySelector('[data-aleya-send]');
        if (sendBtn && !modelReady) sendBtn.disabled = false; // status fast-path still works
        confirmBtn.hidden = !pendingConfirmation;
        setOpenInvoice(lastFocusInvoiceId);
      }
    }

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const textarea = form.querySelector('textarea[name="message"]');
      const message = String(textarea?.value || '').trim();
      if (!message) return;
      textarea.value = '';
      void send(message);
    });
    confirmBtn?.addEventListener('click', () => {
      void send('confirm', { confirm: true });
    });
    cancelBtn?.addEventListener('click', () => {
      abortController?.abort();
    });
  }

  return { aleyaAiPage };
}
