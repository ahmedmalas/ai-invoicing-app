# Module Readiness Matrix

This matrix tracks implementation readiness at module level without prescribing unapproved detailed future implementation.

## Current Project Snapshot
- Current branch: `cursor/ai-invoicing-foundation-19d3`
- Current commit (Slice 12 implementation): `8fad55205d23a096ca1a6bf3c6736d02798df8b9`
- Current implemented slice: **Slice 12 — Team Permissions Foundation**
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
| Foundation | Implemented | Slice 1-12 | Core runtime, DB, timeline taxonomy, validation gates | TBD | Scope drift risk if standards are bypassed | Baseline architecture and workflow controls are present. |
| Jobs | Partial | Slice 4-12 | Customers, Documents, Timeline, Search, Users/Roles, Teams | TBD | Workflow complexity growth | CRUD, linkage, scheduling, assignment, transitions, assignment integrity, team-scope assignment controls, membership lifecycle safeguards, and team deletion safeguards exist. |
| Customers | Partial | Slice 1 | Foundation, Timeline, Search | TBD | Data model expansion without governance | Core customer lifecycle exists. |
| Quotes | Not Started | N/A | Customers, Documents, Timeline, Numbering, PDF | TBD | Contract drift with invoice model | Placeholder only. |
| Invoices | Partial | Slice 1-2 | Customers, Documents, Timeline, Numbering, PDF | TBD | Regulatory/rules expansion risk | Draft/finalise/immutability baseline exists. |
| Payments | Not Started | N/A | Invoices, Timeline, Integrations | TBD | External dependency risk | Placeholder only. |
| Scheduling | Partial | Slice 6 | Jobs, Timeline | TBD | Transition rule complexity | Start/end scheduling exists for jobs. |
| Calendar | Not Started | N/A | Scheduling, Users/Roles, Notifications | TBD | Integration coupling risk | Placeholder only. |
| Teams | Partial | Slice 8-12 | Users/Roles, Jobs, Audit | TBD | Scope expansion into org-management/permissions | Team create/list/get/delete, membership add/remove lifecycle, membership role scaffolding, and scoped deletion safeguards for members/jobs are implemented. |
| Users/Roles | Partial | Slice 7 | Foundation, Audit | TBD | Scope expansion into full auth/permissions | Minimal users/roles persistence, role association, and assignment-policy baseline are implemented. |
| Documents | Partial | Slice 1,5 | Foundation, Search, Timeline | TBD | Schema breadth risk | Document records + job linkage baseline exists. |
| Attachments | Not Started | N/A | Documents, Storage strategy, Audit | TBD | Storage/security risk | Placeholder only. |
| Notifications | Not Started | N/A | Jobs, Invoices, Users/Roles, Calendar | TBD | Delivery reliability and noise risk | Placeholder only. |
| AI Assistant | Not Started | N/A | Documents, Preferences, Audit, Policy controls | TBD | Non-deterministic behavior risk | AI remains intentionally non-foundational. |
| Reporting | Not Started | N/A | Invoices, Jobs, Payments, Audit | TBD | Data quality/consistency risk | Placeholder only. |
| Dashboard | Not Started | N/A | Reporting, Jobs, Invoices | TBD | UX scope creep risk | Placeholder only. |
| Settings | Partial | Slice 1 | Business profile, Preferences, Validation | TBD | Configuration sprawl risk | Branding/preferences baseline exists. |
| Integrations | Not Started | N/A | Security, Audit, Payments, Calendar | TBD | Third-party contract volatility | Placeholder only. |
| Audit | Partial | Slice 1-12 | Timeline taxonomy, Persistence, Search | TBD | Event taxonomy drift risk | Canonical timeline/versioning exists, including team lifecycle, membership lifecycle, and assignment scope events. |
| Administration | Not Started | N/A | Users/Roles, Audit, Settings | TBD | Privilege escalation risk | Placeholder only. |

## Cross-References
- Planning index: `docs/ROADMAP.md`
- Build chronology: `docs/BUILD_LOG.md`
- Documentation governance policy: `docs/DOCUMENTATION_GOVERNANCE.md`
- Engineering workflow and validation gates: `docs/PROJECT_OPERATING_MANUAL.md`
