/**
 * Invoice template import / review / save UI for Aleya.
 * Recreates uploaded invoices as editable design fields (not background images).
 */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve({ base64, dataUrl: result });
    };
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

function designFormHtml(design = {}, analysis = {}) {
  const colors = design.colors || {};
  const business = design.businessDefaults || {};
  const bank = design.bankDetails || {};
  const columns = design.layout?.tableColumns || [];
  return (
    '<div class="template-review-grid">' +
    '<section class="panel"><header class="panel-head"><h2>Recognised design</h2></header><div class="panel-body form">' +
    '<label>Template name<input name="templateName" required maxlength="120" value="' +
    esc(analysis.suggestedName || 'Imported invoice template') +
    '"></label>' +
    '<label>Document title<input name="documentTitle" value="' +
    esc(design.documentTitle || 'TAX INVOICE') +
    '"></label>' +
    '<label>Header style<select name="headerStyle">' +
    ['meta-right', 'split-bill-from', 'stacked']
      .map(
        (value) =>
          '<option value="' +
          value +
          '"' +
          (design.layout?.headerStyle === value ? ' selected' : '') +
          '>' +
          value +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    '<label>Layout preset<select name="layoutPreset">' +
    ['quantum-hire', 'standard']
      .map(
        (value) =>
          '<option value="' +
          value +
          '"' +
          ((design.layout?.layoutPreset || 'standard') === value ? ' selected' : '') +
          '>' +
          (value === 'quantum-hire' ? 'Quantum Hire / Cart N Tip' : 'Standard Aleya') +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    '<label>Logo position<select name="logoPosition">' +
    ['left', 'right', 'none']
      .map(
        (value) =>
          '<option value="' +
          value +
          '"' +
          (design.layout?.logoPosition === value ? ' selected' : '') +
          '>' +
          value +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    '<div class="grid-2">' +
    '<label>Primary colour<input name="primary" type="color" value="' +
    esc(colors.primary || '#173f35') +
    '"></label>' +
    '<label>Secondary colour<input name="secondary" type="color" value="' +
    esc(colors.secondary || '#c4f36b') +
    '"></label>' +
    '</div>' +
    '<label>Heading font<select name="headingFont">' +
    ['Helvetica-Bold', 'Helvetica', 'Times-Bold', 'Times-Roman', 'Courier']
      .map(
        (value) =>
          '<option value="' +
          value +
          '"' +
          ((design.typography?.headingFont || 'Helvetica-Bold') === value ? ' selected' : '') +
          '>' +
          value +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    '</div></section>' +
    '<section class="panel"><header class="panel-head"><h2>Business defaults</h2></header><div class="panel-body form">' +
    '<label>Company name<input name="companyName" value="' +
    esc(business.companyName || '') +
    '"></label>' +
    '<label>ABN<input name="abnTaxId" value="' +
    esc(business.abnTaxId || '') +
    '"></label>' +
    '<label>Email<input name="email" value="' +
    esc(business.email || '') +
    '"></label>' +
    '<label>Phone<input name="phone" value="' +
    esc(business.phone || '') +
    '"></label>' +
    '<label>Address<textarea name="address" rows="2">' +
    esc(business.address || '') +
    '</textarea></label>' +
    '</div></section>' +
    '<section class="panel"><header class="panel-head"><h2>Payment, terms & notes</h2></header><div class="panel-body form">' +
    '<label>Account name<input name="accountName" value="' +
    esc(bank.accountName || '') +
    '"></label>' +
    '<div class="grid-2"><label>BSB<input name="bsb" value="' +
    esc(bank.bsb || '') +
    '"></label><label>Account number<input name="accountNumber" value="' +
    esc(bank.accountNumber || '') +
    '"></label></div>' +
    '<label>Payment details<textarea name="paymentDetails" rows="3">' +
    esc(design.paymentDetails || '') +
    '</textarea></label>' +
    '<label>Terms<textarea name="termsAndConditions" rows="3">' +
    esc(design.termsAndConditions || '') +
    '</textarea></label>' +
    '<label>Notes placeholder<textarea name="notesPlaceholder" rows="3">' +
    esc(design.notesPlaceholder || '') +
    '</textarea></label>' +
    '</div></section>' +
    '<section class="panel"><header class="panel-head"><h2>Table columns</h2></header><div class="panel-body">' +
    '<p class="muted">Toggle which columns appear on future invoices using this template.</p>' +
    '<div class="template-columns">' +
    columns
      .map(
        (column, index) =>
          '<label class="checkbox-row"><input type="checkbox" name="columnVisible_' +
          index +
          '" data-column-id="' +
          esc(column.id) +
          '"' +
          (column.visible ? ' checked' : '') +
          '> <span>' +
          esc(column.label) +
          ' <em>(' +
          esc(column.id) +
          ')</em></span></label>',
      )
      .join('') +
    '</div></div></section>' +
    '</div>'
  );
}

function readDesignFromForm(form, baseDesign) {
  const data = new FormData(form);
  const tableColumns = (baseDesign.layout?.tableColumns || []).map((column, index) => ({
    ...column,
    visible: form.querySelector('[name="columnVisible_' + index + '"]')?.checked !== false,
  }));
  const accountName = String(data.get('accountName') || '').trim();
  const bsb = String(data.get('bsb') || '').trim();
  const accountNumber = String(data.get('accountNumber') || '').trim();
  return {
    ...baseDesign,
    documentTitle: String(data.get('documentTitle') || 'TAX INVOICE'),
    colors: {
      ...baseDesign.colors,
      primary: String(data.get('primary') || baseDesign.colors.primary),
      secondary: String(data.get('secondary') || baseDesign.colors.secondary),
    },
    typography: {
      ...baseDesign.typography,
      headingFont: String(data.get('headingFont') || baseDesign.typography.headingFont),
    },
    layout: {
      ...baseDesign.layout,
      headerStyle: String(data.get('headerStyle') || baseDesign.layout.headerStyle),
      logoPosition: String(data.get('logoPosition') || baseDesign.layout.logoPosition),
      layoutPreset: String(data.get('layoutPreset') || baseDesign.layout.layoutPreset || 'standard'),
      tableColumns,
    },
    businessDefaults: {
      ...baseDesign.businessDefaults,
      companyName: String(data.get('companyName') || '') || null,
      legalName: String(data.get('companyName') || '') || null,
      abnTaxId: String(data.get('abnTaxId') || '') || null,
      email: String(data.get('email') || '') || null,
      phone: String(data.get('phone') || '') || null,
      address: String(data.get('address') || '') || null,
    },
    bankDetails:
      accountName || bsb || accountNumber
        ? {
            accountName: accountName || null,
            bsb: bsb || null,
            accountNumber: accountNumber || null,
            referenceLabel: 'Reference',
          }
        : null,
    paymentDetails: String(data.get('paymentDetails') || '') || null,
    termsAndConditions: String(data.get('termsAndConditions') || '') || null,
    notesPlaceholder: String(data.get('notesPlaceholder') || '') || null,
  };
}

export function createInvoiceTemplatesUi(deps) {
  const { api, toast, navigate, setContent } = deps;
  let draft = null;

  async function templatesListPage() {
    const payload = await api('/api/invoice-templates');
    const templates = payload.templates || [];
    setContent(
      '<section class="page-hero"><div><p class="eyebrow">Invoice templates</p><h1>Recreate your invoice design</h1>' +
        '<p class="lede">Your supplied Cart N Tip #107 invoice is installed as the Quantum Hire editable template. Upload another PDF only if you need a different design.</p></div>' +
        '<div class="hero-actions"><a class="button" href="/templates/import" data-route>Upload invoice</a> ' +
        '<button type="button" class="button secondary" id="template-install-reference">Install Cart N Tip reference</button></div></section>' +
        '<section class="panel"><header class="panel-head"><h2>Saved templates</h2></header><div class="panel-body">' +
        (templates.length
          ? '<table class="data-table"><thead><tr><th>Name</th><th>Source</th><th>Default</th><th></th></tr></thead><tbody>' +
            templates
              .map(
                (item) =>
                  '<tr><td>' +
                  esc(item.name) +
                  '</td><td>' +
                  esc(item.source) +
                  '</td><td>' +
                  (item.isDefault ? 'Yes' : '—') +
                  '</td><td class="row-actions">' +
                  (item.isDefault
                    ? ''
                    : '<button type="button" class="button secondary small" data-template-default="' +
                      esc(item.id) +
                      '">Make default</button> ') +
                  '<button type="button" class="button secondary small" data-template-delete="' +
                  esc(item.id) +
                  '">Delete</button></td></tr>',
              )
              .join('') +
            '</tbody></table>'
          : '<p class="muted">No templates yet. Upload a PDF or image invoice to create one.</p>') +
        '</div></section>',
    );

    document.getElementById('template-install-reference')?.addEventListener('click', async () => {
      try {
        const result = await api('/api/invoice-templates/install-reference', {
          method: 'POST',
          body: JSON.stringify({ force: true }),
        });
        toast(
          result.installed
            ? 'Cart N Tip #107 installed as your default Quantum Hire template.'
            : 'Reference template already available.',
        );
        templatesListPage();
      } catch (error) {
        toast(error?.message || 'Could not install reference template', true);
      }
    });

    document.querySelectorAll('[data-template-default]').forEach((button) => {
      button.addEventListener('click', async () => {
        await api('/api/invoice-templates/' + button.getAttribute('data-template-default') + '/default', {
          method: 'POST',
        });
        toast('Default invoice template updated.');
        templatesListPage();
      });
    });
    document.querySelectorAll('[data-template-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm('Delete this template?')) return;
        await api('/api/invoice-templates/' + button.getAttribute('data-template-delete'), {
          method: 'DELETE',
        });
        toast('Template deleted.');
        templatesListPage();
      });
    });
  }

  async function templatesImportPage() {
    draft = null;
    setContent(
      '<section class="page-hero"><div><p class="eyebrow">Import</p><h1>Upload an invoice to recreate</h1>' +
        '<p class="lede">PDF or image. Aleya extracts layout signals into editable components — not a flat background screenshot.</p></div>' +
        '<a class="button secondary" href="/templates" data-route>Back to templates</a></section>' +
        '<section class="panel"><div class="panel-body form">' +
        '<label class="file-drop">Invoice PDF or image' +
        '<input id="template-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required>' +
        '</label>' +
        '<button class="button" type="button" id="template-analyze">Analyse & recreate</button>' +
        '<p class="muted">Fonts and exact spacing are approximate. You can correct every field before saving.</p>' +
        '</div></section>' +
        '<div id="template-import-result"></div>',
    );

    document.getElementById('template-analyze')?.addEventListener('click', async () => {
      const input = document.getElementById('template-file');
      const file = input?.files?.[0];
      if (!file) {
        toast('Choose a PDF or image first.', true);
        return;
      }
      try {
        const { base64, dataUrl } = await fileToBase64(file);
        const result = await api('/api/invoice-templates/analyze', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || 'application/pdf',
            contentBase64: base64,
          }),
        });
        draft = {
          ...result,
          localPreviewDataUrl: file.type.startsWith('image/')
            ? dataUrl
            : result.originalPreviewDataUrl,
          localPdfDataUrl: file.type === 'application/pdf' ? dataUrl : null,
        };
        renderReview();
        toast('Editable recreation ready — review and save.');
      } catch (error) {
        toast(error?.message || 'Analyse failed', true);
      }
    });
  }

  function renderReview() {
    if (!draft) return;
    const resultHost = document.getElementById('template-import-result');
    if (!resultHost) return;
    const preview =
      draft.localPdfDataUrl
        ? '<iframe class="template-original-frame" title="Uploaded invoice" src="' +
          esc(draft.localPdfDataUrl) +
          '"></iframe>'
        : draft.localPreviewDataUrl
          ? '<img class="template-original-image" alt="Uploaded invoice" src="' +
            esc(draft.localPreviewDataUrl) +
            '">'
          : '<p class="muted">Original preview unavailable; edit the recreated fields below.</p>';

    resultHost.innerHTML =
      '<section class="template-compare">' +
      '<article class="panel"><header class="panel-head"><h2>Uploaded original</h2></header><div class="panel-body">' +
      preview +
      '</div></article>' +
      '<article class="panel"><header class="panel-head"><h2>Editable recreation</h2>' +
      '<span class="muted">Confidence ' +
      Math.round((draft.confidence || 0) * 100) +
      '%</span></header><div class="panel-body">' +
      '<p class="muted">Detected: ' +
      esc((draft.detectedElements || []).join(', ') || 'basic layout') +
      '</p>' +
      '<ul class="template-limitations">' +
      (draft.limitations || []).map((item) => '<li>' + esc(item) + '</li>').join('') +
      '</ul>' +
      '<form id="template-review-form">' +
      designFormHtml(draft.design, { suggestedName: (draft.originalFilename || 'Imported').replace(/\.[^.]+$/, '') }) +
      '<div class="form-actions">' +
      '<label class="checkbox-row"><input type="checkbox" name="applyBusinessDefaults" checked> Also update business profile colours & details</label>' +
      '<label class="checkbox-row"><input type="checkbox" name="isDefault" checked> Save as default invoice template</label>' +
      '<button class="button secondary" type="button" id="template-preview-pdf">Preview recreated PDF</button>' +
      '<button class="button" type="submit">Save template</button>' +
      '</div></form></div></article></section>';

    document.getElementById('template-preview-pdf')?.addEventListener('click', async () => {
      const form = document.getElementById('template-review-form');
      const design = readDesignFromForm(form, draft.design);
      const response = await fetch('/api/invoice-templates/preview-pdf', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + (deps.getAccessToken?.() || ''),
        },
        body: JSON.stringify({ design, title: 'Template preview' }),
      });
      if (!response.ok) {
        toast('Preview failed', true);
        return;
      }
      const blob = await response.blob();
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    });

    document.getElementById('template-review-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const design = readDesignFromForm(form, draft.design);
      const data = new FormData(form);
      try {
        await api('/api/invoice-templates/approve', {
          method: 'POST',
          body: JSON.stringify({
            name: String(data.get('templateName') || 'Imported invoice template'),
            isDefault: form.querySelector('[name="isDefault"]')?.checked !== false,
            applyBusinessDefaults:
              form.querySelector('[name="applyBusinessDefaults"]')?.checked !== false,
            design,
            originalFilename: draft.originalFilename || null,
            originalMimeType: draft.originalMimeType || null,
            source: 'imported',
          }),
        });
        toast('Template saved. New invoices will use this design for PDFs.');
        navigate('/templates');
      } catch (error) {
        toast(error?.message || 'Save failed', true);
      }
    });
  }

  return {
    templatesListPage,
    templatesImportPage,
  };
}
