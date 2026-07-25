# Aleya AI capability matrix

Generated from the live action registry plus a UI/backend operations audit.

Registered tools: **35**

## Product rule

If the authenticated user can legitimately do it in Aleya Invoicing, Aleya AI should eventually be able to do it through natural language — via a registered, permission-checked tool.

Do **not** describe Aleya AI as a complete “full operating layer” while ordinary existing app features remain invisible to Aleya, or while features such as bank feeds are not implemented.

Authoritative product map: `src/ai/product-capabilities.ts` (exposed via `list_product_capabilities` / capabilities API).

## Registered tools (M1)

| Tool | Category | Confirmation | Undo | Milestone | Description |
|---|---|---|---|---|---|
| `bulk_create_drafts_from_rows` | bulk | none | none | M1 | Create multiple draft invoices from structured rows (CSV/spreadsheet-like). Does not finalise. |
| `bulk_update_invoices` | bulk | required | snapshot | M1 | Apply the same reversible draft updates across many invoices matching a filter. Requires confirmation. |
| `create_customer` | customers | none | none | M1 | Create a customer when display name and any provided contact details are clear. No confirmation required. |
| `create_invoice_draft` | invoices | none | snapshot | M1 | Create a new draft invoice with line items. Uses sensible dates/terms when omitted. |
| `delete_customer` | customers | required | none | M1 | Delete a customer when safe. Requires confirmation. |
| `delete_invoice_draft` | invoices | required | none | M1 | Delete a draft invoice. Requires confirmation. |
| `diagnose_invoice_issues` | diagnostics | none | none | M1 | Inspect an invoice for missing customer, empty lines, GST inconsistencies, and profile readiness issues. |
| `duplicate_invoice` | invoices | none | none | M1 | Duplicate an invoice into a new draft, optionally for another customer. |
| `finalise_invoice` | invoices | required | none | M1 | Finalise a draft invoice (assigns invoice number, locks content). Requires confirmation. |
| `get_bank_feed_status` | meta | none | none | M1 | Answer bank-feed / open-banking / connected-bank / bank-sync status questions. Conclusive for “is my bank feed connected?”, last sync, bank-feed errors, and imported bank transactions. Bank feeds are not implemented in this product — returns that fact. Do NOT call get_business_profile for these questions. |
| `get_business_profile` | profile | none | none | M1 | Read business contact/branding details (company name, ABN, address, email, phone, colours). ONLY when the user asks about the business profile, branding, or contact details. NEVER use for bank-feed connectivity, sync status, imported bank transactions, or connection health — those are not in the business profile. Prefer get_bank_feed_status for bank-feed questions. |
| `get_customer` | customers | none | none | M1 | Load a customer record by id. |
| `get_feature_status` | meta | none | none | M1 | Look up whether a named product feature exists and whether Aleya AI can access it. Distinguishes feature-absent vs tool-absent vs permission vs provider issues. Use before offering navigation to a screen. |
| `get_invoice` | invoices | none | none | M1 | Load a full invoice including line items, totals, and bound template id. |
| `get_visible_app_state` | meta | none | none | M1 | Read the UI-visible state passed from the client (active invoice/customer/path). |
| `list_payments` | payments | none | none | M1 | List payments, optionally filtered by customer or invoice. |
| `list_product_capabilities` | meta | none | none | M1 | List what exists in the Aleya product versus what Aleya AI can currently read or change. Use for “what can you control?”, capability audits, or whether a feature exists. Prefer this over guessing or calling unrelated profile tools. |
| `list_registered_tools` | meta | none | none | M1 | List every registered Aleya AI tool with category, confirmation, and undo metadata. Use this to discover capabilities dynamically. |
| `list_templates` | templates | none | none | M1 | List invoice templates available to the authenticated business. |
| `list_unpaid_invoices` | invoices | none | none | M1 | List finalised invoices that still have outstanding balance (unpaid / part-paid / awaiting payment). Use for “which invoices are still unpaid?”. Do not use get_business_profile. |
| `manage_invoice_lines` | invoices | none | snapshot | M1 | Add, replace, reorder, or remove line items on a draft invoice. Prefer this for line-level edits. |
| `prepare_invoice_email` | email | none | none | M1 | Prepare an email draft (subject/body/attachment path) for an invoice. Does not send. |
| `prepare_invoice_pdf` | pdf | none | none | M1 | Generate/export the invoice PDF and return a download path plus byte size. |
| `recalculate_invoice_totals` | invoices | none | none | M1 | Recalculate and explain GST/subtotal/total for an invoice or proposed lines. |
| `record_payment` | payments | required | none | M1 | Record a customer payment and allocate it to one or more invoices. Requires confirmation. |
| `reuse_previous_invoice` | invoices | none | none | M1 | Create a new draft by reusing line items/rates/notes from a previous invoice for a customer (defaults to most recent). |
| `search_customers` | customers | none | none | M1 | Find customers by name, email, phone, or ABN fragment. |
| `search_invoices` | invoices | none | none | M1 | Search and filter invoices by customer, status, payment state, title, invoice number, or template name. “Quantum Hire” means the Quantum Hire invoice layout template, not a customer. When finding a source invoice to duplicate, omit status so Finalised invoices are included; duplicate_invoice creates the new Draft. |
| `set_invoice_payment_state` | invoices | required | none | M1 | Change payment/status state on an invoice (Sent, Awaiting Payment, Paid, Cancelled). Requires confirmation. |
| `set_invoice_template` | templates | none | snapshot | M1 | Bind an invoice template (including Quantum Hire / Cart N Tip) to a draft invoice. |
| `undo_last_ai_edit` | undo | none | none | M1 | Undo the most recent reversible Aleya AI edit in this conversation. |
| `universal_search` | search | none | none | M1 | Search across customers, invoices, quotes, and payments using the app search index. |
| `update_business_profile` | profile | required | none | M1 | Update business profile fields. Overwriting important profile data requires confirmation. |
| `update_customer` | customers | none | snapshot | M1 | Update an existing customer record. |
| `update_invoice_draft` | invoices | none | snapshot | M1 | Update an existing draft invoice (title, dates, notes, terms, payment state, lines, template). |

## User-action coverage

| User action | Aleya AI today | Tool(s) | Confirmation | Undo | Genuine limitation | Milestone |
|---|---|---|---|---|---|---|
| Create invoice draft | Yes | create_invoice_draft | none | snapshot | — | M1 |
| Edit invoice draft fields | Yes | update_invoice_draft | none | snapshot | — | M1 |
| Add/remove/reorder line items | Yes | manage_invoice_lines | none | snapshot | — | M1 |
| Recalculate / explain GST totals | Yes | recalculate_invoice_totals | none | none | — | M1 |
| Duplicate invoice | Yes | duplicate_invoice | none | none | — | M1 |
| Reuse previous invoice lines/rates | Yes | reuse_previous_invoice | none | none | — | M1 |
| Search / filter invoices | Yes | search_invoices | none | none | — | M1 |
| Open / inspect invoice | Yes | get_invoice | none | none | — | M1 |
| Select invoice template | Yes | set_invoice_template / list_templates | none | snapshot | — | M1 |
| Prepare / export PDF | Yes | prepare_invoice_pdf | none | none | — | M1 |
| Prepare invoice email | Yes | prepare_invoice_email | none | none | Does not send | M1 |
| Send invoice email | Partial | prepare_invoice_email | required (future send tool) | none | No outbound mail provider wired yet | M2 |
| Finalise invoice | Yes | finalise_invoice | required | none | Irreversible numbering lock | M1 |
| Delete draft invoice | Yes | delete_invoice_draft | required | none | — | M1 |
| Record payment | Yes | record_payment | required | none | — | M1 |
| List payments | Yes | list_payments | none | none | — | M1 |
| Change payment state (finalised) | Partial | set_invoice_payment_state | required | none | Draft path works; finalised needs dedicated DB mutator where missing | M2 |
| Create customer | Yes | create_customer | none | none | — | M1 |
| Update customer | Yes | update_customer | none | snapshot | — | M1 |
| Delete customer | Yes | delete_customer | required | none | Safe-deletion rules still apply | M1 |
| Search customers | Yes | search_customers | none | none | — | M1 |
| Update business profile / branding | Yes | update_business_profile | required | none | Not bank-feed status | M1 |
| Read business profile | Yes | get_business_profile | none | none | Contact/branding only — never for bank feeds | M1 |
| Bank feed connected / sync / errors / transactions | Yes (honest absent) | get_bank_feed_status | none | none | Feature not implemented in product | M1 |
| List product capabilities / what AI can control | Yes | list_product_capabilities / get_feature_status | none | none | — | M1 |
| List unpaid invoices | Yes | list_unpaid_invoices | none | none | — | M1 |
| Universal search | Yes | universal_search | none | none | Falls back to customer/invoice scan if DB search absent | M1 |
| Bulk create drafts from rows/CSV | Yes | bulk_create_drafts_from_rows | none | none | Structured rows in M1; file upload parser M2 | M1 |
| Bulk update many drafts | Yes | bulk_update_invoices | required | snapshot | — | M1 |
| Diagnose invoice issues | Yes | diagnose_invoice_issues | none | none | — | M1 |
| Undo last reversible AI edit | Yes | undo_last_ai_edit | none | none | Snapshot-based | M1 |
| Discover tools dynamically | Yes | list_registered_tools | none | none | — | M1 |
| Use visible UI state | Yes | get_visible_app_state | none | none | — | M1 |
| Quotes create/convert | No | — | — | — | Quotes exist in app; AI tools not registered | P1 |
| Reports / statements | No | — | — | — | Reports exist in app; AI tools not registered | P1 |
| Dashboard metrics | No | — | — | — | Dashboard exists; AI tools not registered | P1 |
| Live bank feeds / open banking | No (feature absent) | get_bank_feed_status | — | — | Build provider + sync + tools | P1 |
| Supplier bills / AP / POs | No | — | — | — | Register after shared service extraction | P2 |
| Inventory / stocktakes | No | — | — | — | Register after shared service extraction | P2 |
| Logo studio generate/select | No | — | — | — | Wrap existing logo-studio routes | P2 |
| Template analyse/import from upload | Partial | — | — | — | Heuristic analyse API exists; AI tool wrapper | P2 |
| Timeline / audit query | No | — | — | — | Timeline UI exists; AI tools not registered | P2 |
| Notifications | No | — | — | — | Feature not in product | P3 |
| Third-party integrations | No | — | — | — | Feature not in product | P3 |
| Recurring invoices | No | — | — | — | Feature not in product yet | P3 |
| Void finalised invoice | No | — | — | — | Needs explicit void domain operation | P2 |
| Keyboard shortcuts as tools | N/A | — | — | — | Shortcuts map to same tools as UI | — |

## Artificial limits explicitly rejected

- Only one tool call per message
- Only one invoice action per command
- Only predefined sentence patterns / example phrases
- Only the currently open invoice
- Text generation or simulated actions only
- Small hardcoded intent list

## Security boundaries (not product limits)

- No shell/OS, arbitrary code execution, or arbitrary SQL
- No cross-tenant data, secrets, or auth bypass
- No silent irreversible / external actions
- No inventing missing financial or customer information
- Uploaded files are untrusted data (facts only)
