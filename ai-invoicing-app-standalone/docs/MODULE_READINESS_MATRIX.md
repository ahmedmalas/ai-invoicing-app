# Module Readiness Matrix

This matrix tracks implementation readiness at module level without prescribing unapproved detailed future implementation.

## Current Project Snapshot
- Current branch: `cursor/ai-invoicing-foundation-19d3`
- Current commit (Slice 22 implementation): `7db0030f059d3739fdf42634fad6ce8943dba7e4`
- Current implemented slice: **Slice 22 — Purchase Orders (Procurement Foundation)**
- Documentation baseline:
  - `docs/ROADMAP.md`
  - `docs/BUILD_LOG.md`
  - `docs/DOCUMENTATION_GOVERNANCE.md`
  - `docs/PROJECT_OPERATING_MANUAL.md`
- Validation status: baseline currently passing required gates; re-validated during this documentation task.

## Status Legend
- Implemented
- Partial
- Planned (placeholder)
- Not Started

## Matrix
| Module | Status | Current Implemented Slice | Dependencies | Next Planned Work | Risks | Notes |
|---|---|---|---|---|---|---|
| Foundation | Implemented | Slice 1-22 | Core runtime, DB, timeline taxonomy, validation gates | TBD | Scope drift risk if standards are bypassed | Baseline architecture and workflow controls are present. |
| Jobs | Partial | Slice 4-13 | Customers, Documents, Timeline, Search, Users/Roles, Teams | TBD | Workflow complexity growth | CRUD, linkage, scheduling, assignment, transitions, assignment integrity, team-scope assignment controls, membership lifecycle safeguards, team role authorization, and team deletion safeguards exist. |
| Customers | Partial | Slice 1 | Foundation, Timeline, Search | TBD | Data model expansion without governance | Core customer lifecycle exists. |
| Quotes | Not Started | N/A | Customers, Documents, Timeline, Numbering, PDF | TBD | Contract drift with invoice model | Placeholder only. |
| Invoices | Partial | Slice 1-2,14-19 | Customers, Documents, Timeline, Numbering, PDF | TBD | Regulatory/rules expansion risk | Draft/finalise/immutability baseline remains unchanged; lifecycle-safe credit notes and customer payment allocations now exist as linked business records without introducing invoice mutations or ledgers. |
| Payments | Partial | Slice 19 | Invoices, Timeline | TBD | Scope drift into accounting/ledger behavior | Customer payment capture/allocation and receipt rendering are implemented with deterministic allocation guards; no ledger or double-entry accounting exists. |
| Scheduling | Partial | Slice 6 | Jobs, Timeline | TBD | Transition rule complexity | Start/end scheduling exists for jobs. |
| Calendar | Not Started | N/A | Scheduling, Users/Roles, Notifications | TBD | Integration coupling risk | Placeholder only. |
| Teams | Partial | Slice 8-13 | Users/Roles, Jobs, Audit | TBD | Scope expansion into org-management/permissions | Team create/list/get/delete, membership add/remove/role-update lifecycle, role authorization rules, membership role scaffolding, and team/job integrity safeguards are implemented. |
| Users/Roles | Partial | Slice 7 | Foundation, Audit | TBD | Scope expansion into full auth/permissions | Minimal users/roles persistence, role association, and assignment-policy baseline are implemented. |
| Documents | Partial | Slice 1,5,18-22 | Foundation, Search, Timeline | TBD | Schema breadth risk | Document records, job linkage baseline, credit note documents, customer payment receipts, supplier bill documents, supplier payment receipts, and purchase order procurement documents are implemented. |
| Accounts Payable | Partial | Slice 20-21 | Suppliers, Documents, Timeline, PDF | TBD | Scope drift into full accounting/ledger behavior | Supplier and supplier bill operational purchasing foundation includes supplier payment allocation workflows with deterministic validation and no ledger/double-entry behavior. |
| Procurement | Partial | Slice 22 | Suppliers, Documents, Timeline, PDF | TBD | Scope drift into inventory/goods-receipt features | Purchase order draft/approved/closed/cancelled lifecycle exists with deterministic validation, immutable non-draft behavior, rendering, and search participation; inventory and goods receipt are intentionally out of scope. |
| Attachments | Not Started | N/A | Documents, Storage strategy, Audit | TBD | Storage/security risk | Placeholder only. |
| Notifications | Not Started | N/A | Jobs, Invoices, Users/Roles, Calendar | TBD | Delivery reliability and noise risk | Placeholder only. |
| AI Assistant | Not Started | N/A | Documents, Preferences, Audit, Policy controls | TBD | Non-deterministic behavior risk | AI remains intentionally non-foundational. |
| Reporting | Partial | Slice 16-17 | Invoices, Customers, PDF, Audit | TBD | Scope drift into accounting/ledger behavior | Read-only customer statements (JSON/HTML/PDF) are implemented with deterministic filtering and export hardening; no ledger persistence or payment allocation exists. |
| Dashboard | Not Started | N/A | Reporting, Jobs, Invoices | TBD | UX scope creep risk | Placeholder only. |
| Settings | Partial | Slice 1 | Business profile, Preferences, Validation | TBD | Configuration sprawl risk | Branding/preferences baseline exists. |
| Integrations | Not Started | N/A | Security, Audit, Payments, Calendar | TBD | Third-party contract volatility | Placeholder only. |
| Audit | Partial | Slice 1-22 | Timeline taxonomy, Persistence, Search | TBD | Event taxonomy drift risk | Canonical timeline/versioning exists, including invoice finalisation, `credit_note.created`, `payment.created`, `payment.allocated`, `supplier_bill.created`, `supplier_bill.finalised`, `supplier_payment.created`, `supplier_payment.allocated`, `purchase_order.created`, `purchase_order.approved`, `purchase_order.closed`, and `purchase_order.cancelled`; statement generation remains read-only and intentionally does not emit read/query audit events. |
| Administration | Not Started | N/A | Users/Roles, Audit, Settings | TBD | Privilege escalation risk | Placeholder only. |

## Cross-References
- Planning index: `docs/ROADMAP.md`
- Build chronology: `docs/BUILD_LOG.md`
- Documentation governance policy: `docs/DOCUMENTATION_GOVERNANCE.md`
- Engineering workflow and validation gates: `docs/PROJECT_OPERATING_MANUAL.md`
