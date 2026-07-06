# Build Log

## 2026-07-06

### Foundation Initialization
- Created standalone project folder: `ai-invoicing-app-standalone`
- Added root project overview: `README.md`
- Added vision document: `docs/VISION.md`
- Added features baseline: `docs/FEATURES.md`
- Added technical decision baseline: `docs/TECH_DECISIONS.md`
- Added this build log: `docs/BUILD_LOG.md`

### Notes
- Recovery-based patching was intentionally not used.
- Project is being rebuilt from source-of-truth requirements.
- No application implementation started in this step.

### Product Vision Pivot (Document Platform First)
- Updated `README.md` from invoice-only framing to document-platform-first framing.
- Updated `docs/VISION.md` to support personal + business document workflows.
- Updated `docs/FEATURES.md` with multi-document creation, conversion, secure storage, branding, recommendations, and preference memory.
- Updated `docs/TECH_DECISIONS.md` with confirmed product pivot decisions and additional open decisions for document-platform architecture.
- Added `docs/PRODUCT_PIVOT.md` to capture pivot rationale and product consequences.
- Added `docs/DOCUMENT_PLATFORM_MODEL.md` to define baseline platform model and document lifecycle.

### Notes
- Slice 1 remains implementation-planning only at this stage.
- No application code implementation started in this step.

### Product Vision Pivot (AI Business OS)
- Updated `README.md` to position the product as an AI Business OS with editions and document-platform scope.
- Updated `docs/VISION.md` with expanded mission, target users, and document + operations outcomes.
- Expanded `docs/FEATURES.md` into 18 platform capabilities including AI memory, customer/supplier profiles, smart sending, payment centre, timeline, reminders, accountant portal, spending intelligence, financial hub, integrations, and subscription strategy.
- Updated `docs/TECH_DECISIONS.md` with AI Business OS baselines, edition strategy, integration strategy, and compliance/truthfulness guardrails.
- Updated `docs/PRODUCT_PIVOT.md` from document-platform pivot to AI Business OS pivot framing.
- Updated `docs/DOCUMENT_PLATFORM_MODEL.md` with generalized entities, intelligence pipeline, and profile-centered memory model.
- Added `docs/AI_BUSINESS_OS.md` as the canonical product blueprint.
- Added `docs/INVOICE_LIFECYCLE.md` for invoice-first timeline and state model.
- Added `docs/PAYMENT_AND_BANK_FEEDS.md` for payment centre behavior and future bank-feed matching.
- Added `docs/ACCOUNTANT_PORTAL.md` for advisor access model.
- Added `docs/INTEGRATIONS.md` for standalone-first integration policy.
- Added `docs/SUBSCRIPTIONS.md` for plan structure and tax-language guardrails.

### Notes
- This update is documentation-only.
- No application code implementation started in this step.

### Slice Implementation Milestones (Executed)

#### Slice 1 — Invoice Vertical Foundation
- Implemented backend-first vertical for customer/profile/preferences, invoice draft/finalise, GST totals, PDF generation, timeline, and search scaffolding.
- Added unit, integration, and e2e coverage with build/type/lint/test gates.

#### Slice 2 — DB-Level Finalised Invoice Immutability
- Added SQLite trigger/constraint hardening so finalised invoice core data is immutable at persistence level.
- Preserved allowed payment/reminder updates and added deterministic conflict handling.

#### Slice 3 — Timeline Event Taxonomy + Versioning
- Replaced ad-hoc timeline strings with canonical typed/versioned taxonomy keys.
- Added migration-safe legacy compatibility and taxonomy enforcement trigger coverage.

#### Slice 4 — Jobs Entity Foundation
- Added first-class `jobs` domain, persistence, API routes, timeline events, and search integration.
- Added tests for CRUD, customer linkage, timeline, and e2e flow.

#### Slice 5 — Job Documents + Invoice Linkage
- Extended `job_document_links` scaffolding into working linkage/listing support for job-document and job-invoice links.
- Added timeline linkage events and deterministic duplicate-link conflicts.

#### Slice 6 — Jobs Workflow Foundation
- Commit: `3ca48a2ad4d29f3e1a733a808b91758136496cfc`
- Added scheduling windows, assignment fields, validated status transition workflow, and timeline events for scheduling/assignment/status changes.
- Added unit, integration, and e2e tests for workflow behavior and validation.

#### Slice 7 — Users/Roles Foundation + Job Assignment Integrity
- Commit: `53277c89e10c31fd922a63449c964d756353996b`
- Added minimal users/roles persistence with user-role association links.
- Added create/list/get APIs for users and roles using existing backend route patterns.
- Enforced assignment integrity for jobs so assigned users must exist, be active, and have assignable roles; canonicalized assignment display names from user records.
- Added deterministic error handling for orphan assignment IDs and assignment policy violations.
- Added unit, integration, and e2e coverage for users/roles foundations and assignment integrity.

#### Slice 8 — Teams Membership Foundation + Assignment Scope Controls
- Commit: `44b44185c7fa5f82f7097e23c1008de90f7f3d60`
- Added minimal teams persistence with create/list/get support.
- Added team membership persistence with deterministic duplicate handling.
- Extended jobs with optional `teamId` and team-scoped assignment validation.
- Enforced deterministic `ASSIGNED_USER_OUTSIDE_TEAM_SCOPE` validation when team-scoped assignments are invalid.
- Preserved Slice 6/7 behavior for jobs when `teamId` is absent.
- Added unit, integration, and e2e tests for team validation, memberships, and assignment scope controls.

#### Slice 9 — Team Membership Lifecycle Integrity
- Commit: `5549776666f2f663c67ff3a834a4e753d7e61537`
- Added `DELETE /teams/:teamId/members/:userId` for team member removal.
- Blocked team member removal when user has assigned jobs scoped to the same team using deterministic `TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS`.
- Added `team.member_removed` timeline taxonomy event and persistence emission on successful removals.
- Added tests for blocked/successful removal lifecycle and regression coverage for existing team assignment behavior.

### Current Project Status Snapshot
- Branch: `cursor/ai-invoicing-foundation-19d3`
- Status at logging: implementation baseline completed through Slice 9 and passing validation gates.

### Pre-Slice 1 Architecture Freeze
- Added `docs/PRODUCT_PRINCIPLES.md` as constitution-level principles for AI Business OS.
- Updated vision and architecture docs to make universal search a mandatory platform capability.
- Introduced Jobs as a first-class platform entity and linked model.
- Expanded immutable timeline requirements to all meaningful platform actions.
- Added explicit user ownership and portability requirements (export, backup, migration, import, no lock-in).
- Added professional quality acceptance criteria for generated documents.
- Added progressive complexity UX philosophy as a required product behavior.
- Added dedicated architecture docs: `SEARCH_AND_TIMELINE_ARCHITECTURE.md`, `JOBS_MODEL.md`, `DATA_OWNERSHIP.md`, `QUALITY_STANDARD.md`, and `UX_PHILOSOPHY.md`.

### Notes
- This update is documentation-only.
- No application code implementation started in this step.
