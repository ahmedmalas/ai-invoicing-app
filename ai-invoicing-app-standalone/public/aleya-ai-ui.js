/**
 * Aleya AI workspace — natural-language operating layer UI.
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
    const caps = await deps.api('/api/aleya-ai/capabilities').catch(() => ({
      tools: [],
      toolCount: 0,
      providerConfigured: false,
    }));
    const modelReady = Boolean(caps.providerConfigured);
    const modelLabel = caps.model || 'openai/gpt-5.4';
    const authLabel = caps.authMethod && caps.authMethod !== 'none' ? caps.authMethod : 'unconfigured';

    deps.shell(
      '<main class="page aleya-ai-page">' +
        deps.pageHead(
          'Aleya AI',
          'Natural-language operating layer',
          'Describe the result you want. Aleya plans the steps, uses registered application tools, and reports back.',
        ) +
        '<section class="aleya-ai-layout">' +
        '<div class="aleya-ai-panel">' +
        '<div class="aleya-ai-meta muted">' +
        escapeHtml(String(caps.toolCount || 0)) +
        ' registered tools · max chain ' +
        escapeHtml(String(caps.maxSteps || 48)) +
        ' steps · ' +
        (modelReady
          ? 'model ready (' + escapeHtml(modelLabel) + ' via ' + escapeHtml(authLabel) + ')'
          : 'production natural-language model connection not yet configured') +
        '</div>' +
        '<div class="aleya-ai-thread" data-aleya-thread>' +
        renderMessage(
          'assistant',
          modelReady
            ? 'I can create and edit drafts, manage customers and templates, prepare PDFs and emails, run bulk updates, finalise with confirmation, and more. Ask in ordinary language.'
            : 'Action registry and tool execution infrastructure are deployed; production natural-language model connection is not yet configured. I will not simulate success until the model provider is connected.',
        ) +
        '</div>' +
        '<div class="aleya-ai-confirm" data-aleya-confirm hidden></div>' +
        '<form class="aleya-ai-composer" data-aleya-form>' +
        '<textarea name="message" rows="3" placeholder="e.g. Create a draft for Westbrook with two labour lines at $95.50, use the Quantum Hire template, and prepare the PDF — do not finalise." required></textarea>' +
        '<div class="aleya-ai-actions">' +
        '<button type="submit" class="button" data-aleya-send' +
        (modelReady ? '' : ' disabled title="Model provider not configured"') +
        '>Send</button>' +
        '<button type="button" class="button secondary" data-aleya-confirm-btn hidden>Confirm and continue</button>' +
        '<a class="button secondary" data-aleya-open-invoice hidden href="#">Open invoice</a>' +
        '</div></form></div>' +
        '<aside class="aleya-ai-side">' +
        '<h2>Registered capabilities</h2>' +
        '<ul class="aleya-ai-tool-list">' +
        (caps.tools || [])
          .slice(0, 40)
          .map(
            (tool) =>
              '<li><strong>' +
              escapeHtml(tool.tool) +
              '</strong><span>' +
              escapeHtml(tool.category) +
              (tool.confirmation === 'required' ? ' · confirm' : '') +
              (tool.undo !== 'none' ? ' · undo' : '') +
              '</span></li>',
          )
          .join('') +
        '</ul>' +
        '<p class="muted">New Aleya features register as tools automatically — the chat system is not rebuilt per command.</p>' +
        '</aside></section></main>',
    );

    const thread = document.querySelector('[data-aleya-thread]');
    const form = document.querySelector('[data-aleya-form]');
    const confirmBox = document.querySelector('[data-aleya-confirm]');
    const confirmBtn = document.querySelector('[data-aleya-confirm-btn]');
    const openInvoiceBtn = document.querySelector('[data-aleya-open-invoice]');

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
      openInvoiceBtn.setAttribute('href', '/workspace/invoices/' + encodeURIComponent(invoiceId));
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
        append(
          'assistant',
          'Model provider is not configured. Aleya will not run a simulated or hardcoded command.',
          { kind: 'error' },
        );
        return;
      }
      busy = true;
      form?.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
      });
      let progressEl = null;
      try {
        if (!confirm) append('user', message);
        append('assistant', 'Working — calling the model and registered tools…', {
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
        if (result.decisions?.length) {
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
        append('assistant', error.message || 'Request failed.', { kind: 'error' });
        deps.toast?.(error.message || 'Aleya AI request failed', true);
      } finally {
        busy = false;
        form?.querySelectorAll('button').forEach((button) => {
          button.disabled = false;
        });
        const sendBtn = form?.querySelector('[data-aleya-send]');
        if (sendBtn && !modelReady) sendBtn.disabled = true;
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
  }

  return { aleyaAiPage };
}
