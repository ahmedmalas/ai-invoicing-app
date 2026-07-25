/**
 * Emit docs/ALEYA_AI_CAPABILITY_MATRIX.md from the live registry + UI audit table.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'inherit' });

const { ensureAleyaToolsRegistered } = await import(
  join(ROOT, 'dist/src/ai/tools/register-all.js')
);
const { resetAleyaRegistryForTests, getAleyaRegistry } = await import(
  join(ROOT, 'dist/src/ai/registry.js')
);

resetAleyaRegistryForTests();
const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
const tools = registry.capabilityRows().sort((a, b) => a.tool.localeCompare(b.tool));

const uiActions = [
  ['Create invoice draft', 'Yes', 'create_invoice_draft', 'none', 'snapshot', '—', 'M1'],
  ['Edit invoice draft fields', 'Yes', 'update_invoice_draft', 'none', 'snapshot', '—', 'M1'],
  ['Add/remove/reorder line items', 'Yes', 'manage_invoice_lines', 'none', 'snapshot', '—', 'M1'],
  ['Recalculate / explain GST totals', 'Yes', 'recalculate_invoice_totals', 'none', 'none', '—', 'M1'],
  ['Duplicate invoice', 'Yes', 'duplicate_invoice', 'none', 'none', '—', 'M1'],
  ['Reuse previous invoice lines/rates', 'Yes', 'reuse_previous_invoice', 'none', 'none', '—', 'M1'],
  ['Search / filter invoices', 'Yes', 'search_invoices', 'none', 'none', '—', 'M1'],
  ['Open / inspect invoice', 'Yes', 'get_invoice', 'none', 'none', '—', 'M1'],
  ['Select invoice template', 'Yes', 'set_invoice_template / list_templates', 'none', 'snapshot', '—', 'M1'],
  ['Prepare / export PDF', 'Yes', 'prepare_invoice_pdf', 'none', 'none', '—', 'M1'],
  ['Prepare invoice email', 'Yes', 'prepare_invoice_email', 'none', 'none', 'Does not send', 'M1'],
  ['Send invoice email', 'Partial', 'prepare_invoice_email', 'required (future send tool)', 'none', 'No outbound mail provider wired yet', 'M2'],
  ['Finalise invoice', 'Yes', 'finalise_invoice', 'required', 'none', 'Irreversible numbering lock', 'M1'],
  ['Delete draft invoice', 'Yes', 'delete_invoice_draft', 'required', 'none', '—', 'M1'],
  ['Record payment', 'Yes', 'record_payment', 'required', 'none', '—', 'M1'],
  ['List payments', 'Yes', 'list_payments', 'none', 'none', '—', 'M1'],
  ['Change payment state (finalised)', 'Partial', 'set_invoice_payment_state', 'required', 'none', 'Draft path works; finalised needs dedicated DB mutator where missing', 'M2'],
  ['Create customer', 'Yes', 'create_customer', 'none', 'none', '—', 'M1'],
  ['Update customer', 'Yes', 'update_customer', 'none', 'snapshot', '—', 'M1'],
  ['Delete customer', 'Yes', 'delete_customer', 'required', 'none', 'Safe-deletion rules still apply', 'M1'],
  ['Search customers', 'Yes', 'search_customers', 'none', 'none', '—', 'M1'],
  ['Update business profile / branding', 'Yes', 'update_business_profile', 'required', 'none', 'Not bank-feed status', 'M1'],
  ['Read business profile', 'Yes', 'get_business_profile', 'none', 'none', 'Contact/branding only — never for bank feeds', 'M1'],
  ['Bank feed connected / sync / errors / transactions', 'Yes (honest absent)', 'get_bank_feed_status', 'none', 'none', 'Feature not implemented in product', 'M1'],
  ['List product capabilities / what AI can control', 'Yes', 'list_product_capabilities / get_feature_status', 'none', 'none', '—', 'M1'],
  ['List unpaid invoices', 'Yes', 'list_unpaid_invoices', 'none', 'none', '—', 'M1'],
  ['Universal search', 'Yes', 'universal_search', 'none', 'none', 'Falls back to customer/invoice scan if DB search absent', 'M1'],
  ['Bulk create drafts from rows/CSV', 'Yes', 'bulk_create_drafts_from_rows', 'none', 'none', 'Structured rows in M1; file upload parser M2', 'M1'],
  ['Bulk update many drafts', 'Yes', 'bulk_update_invoices', 'required', 'snapshot', '—', 'M1'],
  ['Diagnose invoice issues', 'Yes', 'diagnose_invoice_issues', 'none', 'none', '—', 'M1'],
  ['Undo last reversible AI edit', 'Yes', 'undo_last_ai_edit', 'none', 'none', 'Snapshot-based', 'M1'],
  ['Discover tools dynamically', 'Yes', 'list_registered_tools', 'none', 'none', '—', 'M1'],
  ['Use visible UI state', 'Yes', 'get_visible_app_state', 'none', 'none', '—', 'M1'],
  ['Quotes create/convert', 'No', '—', '—', '—', 'Quotes exist in app; AI tools not registered', 'P1'],
  ['Reports / statements', 'No', '—', '—', '—', 'Reports exist in app; AI tools not registered', 'P1'],
  ['Dashboard metrics', 'No', '—', '—', '—', 'Dashboard exists; AI tools not registered', 'P1'],
  ['Live bank feeds / open banking', 'No (feature absent)', 'get_bank_feed_status', '—', '—', 'Build provider + sync + tools', 'P1'],
  ['Supplier bills / AP / POs', 'No', '—', '—', '—', 'Register after shared service extraction', 'P2'],
  ['Inventory / stocktakes', 'No', '—', '—', '—', 'Register after shared service extraction', 'P2'],
  ['Logo studio generate/select', 'No', '—', '—', '—', 'Wrap existing logo-studio routes', 'P2'],
  ['Template analyse/import from upload', 'Partial', '—', '—', '—', 'Heuristic analyse API exists; AI tool wrapper', 'P2'],
  ['Timeline / audit query', 'No', '—', '—', '—', 'Timeline UI exists; AI tools not registered', 'P2'],
  ['Notifications', 'No', '—', '—', '—', 'Feature not in product', 'P3'],
  ['Third-party integrations', 'No', '—', '—', '—', 'Feature not in product', 'P3'],
  ['Recurring invoices', 'No', '—', '—', '—', 'Feature not in product yet', 'P3'],
  ['Void finalised invoice', 'No', '—', '—', '—', 'Needs explicit void domain operation', 'P2'],
  ['Keyboard shortcuts as tools', 'N/A', '—', '—', '—', 'Shortcuts map to same tools as UI', '—'],
];

const lines = [];
lines.push('# Aleya AI capability matrix');
lines.push('');
lines.push('Generated from the live action registry plus a UI/backend operations audit.');
lines.push('');
lines.push(`Registered tools: **${tools.length}**`);
lines.push('');
lines.push('## Product rule');
lines.push('');
lines.push('If the authenticated user can legitimately do it in Aleya Invoicing, Aleya AI should eventually be able to do it through natural language — via a registered, permission-checked tool.');
lines.push('');
lines.push('Do **not** describe Aleya AI as a complete “full operating layer” while ordinary existing app features remain invisible to Aleya, or while features such as bank feeds are not implemented.');
lines.push('');
lines.push('Authoritative product map: `src/ai/product-capabilities.ts` (exposed via `list_product_capabilities` / capabilities API).');
lines.push('');
lines.push('## Registered tools (M1)');
lines.push('');
lines.push('| Tool | Category | Confirmation | Undo | Milestone | Description |');
lines.push('|---|---|---|---|---|---|');
for (const tool of tools) {
  lines.push(
    `| \`${tool.tool}\` | ${tool.category} | ${tool.confirmation} | ${tool.undo} | ${tool.milestone} | ${tool.description.replaceAll('|', '\\|')} |`,
  );
}
lines.push('');
lines.push('## User-action coverage');
lines.push('');
lines.push('| User action | Aleya AI today | Tool(s) | Confirmation | Undo | Genuine limitation | Milestone |');
lines.push('|---|---|---|---|---|---|---|');
for (const row of uiActions) {
  lines.push(`| ${row.join(' | ')} |`);
}
lines.push('');
lines.push('## Artificial limits explicitly rejected');
lines.push('');
lines.push('- Only one tool call per message');
lines.push('- Only one invoice action per command');
lines.push('- Only predefined sentence patterns / example phrases');
lines.push('- Only the currently open invoice');
lines.push('- Text generation or simulated actions only');
lines.push('- Small hardcoded intent list');
lines.push('');
lines.push('## Security boundaries (not product limits)');
lines.push('');
lines.push('- No shell/OS, arbitrary code execution, or arbitrary SQL');
lines.push('- No cross-tenant data, secrets, or auth bypass');
lines.push('- No silent irreversible / external actions');
lines.push('- No inventing missing financial or customer information');
lines.push('- Uploaded files are untrusted data (facts only)');
lines.push('');

writeFileSync(join(ROOT, 'docs/ALEYA_AI_CAPABILITY_MATRIX.md'), lines.join('\n'));
console.log(`Wrote matrix with ${tools.length} tools`);
