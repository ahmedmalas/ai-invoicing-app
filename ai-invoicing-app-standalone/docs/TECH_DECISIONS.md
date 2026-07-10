# Technical Decisions (Initial)

## Decision State
This file captures technical direction and open decisions for the standalone AI Business OS rebuild.

## Confirmed Decisions

1. Standalone Repository Structure
   - The project foundation is isolated under `ai-invoicing-app-standalone`.
   - No recovery or partial patching from unavailable prior standalone commits.

2. Documentation-First Bootstrap
   - Establish core product intent and scope before implementation.
   - Keep this phase limited to foundational docs.

3. Scope Guardrails for This Phase
   - Do not scaffold full application code.
   - Do not integrate with unrelated repositories.
   - Do not perform remote operations (e.g., push).

4. Product Pivot Baseline
   - The product is now an AI Business OS.
   - The platform is document-first and invoice-second.
   - Target users include personal users, businesses, accountants/bookkeepers/BAS agents, and future enterprise teams.

5. Platform Capability Baseline
   - Support creation/upload/extraction/storage/recreation/conversion/branding/sending/tracking for documents.
   - Support reusable templates, brand profiles, AI memory, and preference-aware recommendations.
   - Support immutable timeline logging and auditability across document and payment lifecycle actions.

6. Edition Strategy Baseline
   - Product editions: Personal, Business, Professional, and future Enterprise.
   - Platform should keep core data model reusable across editions, with feature gating by plan/policy.

7. Integration Strategy Baseline
   - Platform works standalone first.
   - External integrations are optional and additive (accounting suites, storage suites, email import, future ATO and banking channels).

8. Compliance and Truthfulness Guardrail
   - Payment status transitions must be confidence/rule based and reviewable.
   - Reminder logic must avoid false non-payment claims in uncertain states.
   - Subscription messaging must not promise universal tax deductibility; users should verify with advisors.

9. Universal Search Is Mandatory
   - Cross-entity search is a core platform service from architecture start, not a deferred enhancement.
   - Search domain includes documents, customers, suppliers, photos, logos, receipts, invoices, quotes, purchase orders, delivery dockets, contracts, payments, expenses, notes, AI memories, jobs, attachments, and timeline events.

10. Jobs Are First-Class
   - Jobs are first-class relational containers for work context across documents, parties, media, financial activity, notes, AI memory, and timelines.
   - Core entities should be job-linkable where applicable.

11. Immutable Platform Timeline
   - Every meaningful action across platform domains should emit immutable timeline events.
   - Timeline is both operational history and audit substrate.

12. User Ownership and Portability Guarantee
   - Export, full backup, migration, and import are mandatory platform capabilities.
   - No architectural dependency should enforce vendor lock-in.

13. Professional Quality Gate
   - Generated documents must satisfy send-ready acceptance criteria before release.
   - Quality dimensions include layout, typography, branding, spacing, logo handling, PDF fidelity, and accessibility baseline.

14. Progressive Complexity UX Rule
   - New-user workflows must remain simple and low-friction.
   - Advanced power should be discoverable and naturally unlock over time.

## Open Decisions (Deferred)
- Frontend framework and rendering strategy.
- Backend architecture and persistence model.
- PDF rendering engine and template technology.
- AI provider strategy and prompt architecture.
- Authentication and multi-tenant data boundaries.
- Deployment model and CI/CD flow.
- Document type ontology and normalization strategy.
- Extraction confidence model and review workflow.
- Preference learning model and controls for user override.
- Branding assistant boundaries (suggestion-only vs generated assets).
- Smart sending channel architecture and provider selection.
- Event timeline immutability model and retention policies.
- Bank feed provider strategy by jurisdiction and availability.
- Integration depth for MYOB/Xero/QuickBooks/Reckon by edition.
- Advisor permission model granularity and audit requirements.
- Search indexing strategy, ranking model, and query semantics.
- Timeline event taxonomy governance and versioning.
- Job lifecycle/state model and cross-entity linking constraints.
- Backup/export format standardization and portability test policy.
- Accessibility conformance targets for generated documents.

## Next Step
Translate AI Business OS requirements into Slice 1 architecture (invoice-first lifecycle) without constraining multi-document platform expansion.
