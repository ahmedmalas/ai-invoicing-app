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

export function createAleyaAiUi(deps) {
  let conversationId = null;
  let pendingConfirmation = null;
  let busy = false;

  function renderMessage(role, content) {
    return (
      '<div class="aleya-msg aleya-msg-' +
      escapeHtml(role) +
      '"><div class="aleya-msg-role">' +
      (role === 'user' ? 'You' : 'Aleya AI') +
      '</div><div class="aleya-msg-body">' +
      escapeHtml(content).replaceAll('\n', '<br>') +
      '</div></div>'
    );
  }

  async function aleyaAiPage() {
    const caps = await deps.api('/api/aleya-ai/capabilities').catch(() => ({ tools: [], toolCount: 0 }));
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
        (caps.providerConfigured ? 'model ready' : 'configure AI Gateway to enable the model') +
        '</div>' +
        '<div class="aleya-ai-thread" data-aleya-thread>' +
        renderMessage(
          'assistant',
          'I can create and edit drafts, manage customers and templates, prepare PDFs and emails, run bulk updates, finalise with confirmation, and more. Ask in ordinary language.',
        ) +
        '</div>' +
        '<div class="aleya-ai-confirm" data-aleya-confirm hidden></div>' +
        '<form class="aleya-ai-composer" data-aleya-form>' +
        '<textarea name="message" rows="3" placeholder="e.g. Create a draft for Westbrook with two labour lines at $95.50, use the Quantum Hire template, and prepare the PDF — do not finalise." required></textarea>' +
        '<div class="aleya-ai-actions">' +
        '<button type="submit" class="button" data-aleya-send>Send</button>' +
        '<button type="button" class="button secondary" data-aleya-confirm-btn hidden>Confirm and continue</button>' +
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

    function append(role, content) {
      if (!thread) return;
      thread.insertAdjacentHTML('beforeend', renderMessage(role, content));
      thread.scrollTop = thread.scrollHeight;
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
      busy = true;
      form?.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
      });
      try {
        if (!confirm) append('user', message);
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
        conversationId = result.conversationId;
        append('assistant', result.assistantMessage || 'Done.');
        showConfirm(result.pendingConfirmation || null);
        if (result.ui?.refresh?.includes('invoices') || result.ui?.refresh?.includes('customers')) {
          deps.invalidateCache?.();
        }
        if (result.ui?.openRoute) {
          // Leave navigation optional — user stays in Aleya AI unless they click through.
        }
        if (result.decisions?.length) {
          append('assistant', 'Decisions:\n- ' + result.decisions.join('\n- '));
        }
      } catch (error) {
        append('assistant', error.message || 'Request failed.');
        deps.toast?.(error.message || 'Aleya AI request failed', true);
      } finally {
        busy = false;
        form?.querySelectorAll('button').forEach((button) => {
          button.disabled = false;
        });
        confirmBtn.hidden = !pendingConfirmation;
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
