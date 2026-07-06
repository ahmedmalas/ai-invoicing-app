# Milestone 01 Implementation Plan

## Purpose
Translate the current roadmap and architecture baseline into an actionable execution plan for Milestone 01 without introducing unapproved scope.

## Milestone 01 Objectives
- Establish a production-grade backend foundation for deterministic invoicing and job workflows.
- Prove architecture viability for:
  - document records
  - immutable timeline taxonomy
  - search scaffolding
  - invoice immutability guarantees
  - jobs lifecycle, linkage, scheduling, and transitions
- Lock in slice-based engineering workflow with mandatory validation gates and audit traceability.

## Roadmap Slices in Milestone 01
Milestone 01 includes completed foundational slices:
1. Slice 1 — Invoice Vertical Foundation
2. Slice 2 — DB-Level Finalised Invoice Immutability
3. Slice 3 — Timeline Event Taxonomy + Versioning
4. Slice 4 — Jobs Entity Foundation
5. Slice 5 — Job Documents + Invoice Linkage
6. Slice 6 — Jobs Workflow Foundation

Future slices remain `TBD` per roadmap policy.

## Prerequisites
- Architecture and governance baseline docs exist and are current:
  - `docs/ROADMAP.md`
  - `docs/VISION_AND_ARCHITECTURE.md`
  - `docs/MODULE_READINESS_MATRIX.md`
  - `docs/BUILD_LOG.md`
  - `docs/DOCUMENTATION_GOVERNANCE.md`
  - `docs/PROJECT_OPERATING_MANUAL.md`
- Current branch baseline is clean and traceable in git history.
- Mandatory gates are available and passing in current development environment.

## Implementation Order
1. Slice 1: establish invoice/customer/profile/preferences vertical and baseline test harness.
2. Slice 2: harden finalised invoice immutability at DB layer.
3. Slice 3: standardize timeline taxonomy/versioning and enforce write-time validity.
4. Slice 4: introduce jobs as first-class entity with API, persistence, timeline, and search integration.
5. Slice 5: add job-document linkage and invoice linkage support with deterministic behavior.
6. Slice 6: add scheduling, assignment, and valid server-side status transition workflow.

## Dependencies Between Slices
- Slice 2 depends on Slice 1 invoice persistence model and finalisation behavior.
- Slice 3 depends on existing timeline emissions from Slice 1/2.
- Slice 4 depends on Slice 3 taxonomy for canonical job event emission.
- Slice 5 depends on Slice 4 jobs model and Slice 1 document/invoice records.
- Slice 6 depends on Slice 4 jobs lifecycle and Slice 3 taxonomy enforcement.

## Technical Risks
- Timeline taxonomy drift if new events are introduced without canonical registration.
- Workflow complexity growth in jobs status transitions and scheduling rules.
- Migration safety regressions when expanding schema in-place.
- Scope creep into unplanned modules (teams/users/notifications/integrations) before explicit slice approval.
- Determinism erosion if rule enforcement moves away from validated domain + DB guardrails.

## Completion Criteria
Milestone 01 is complete when all are true:
- Slices 1 through 6 are implemented and committed.
- Required behavior is covered by unit/integration/e2e tests.
- Validation gates pass for milestone baseline.
- Build log and roadmap reflect milestone state and commit traceability.
- No unapproved module expansion beyond established slices.

## Acceptance Tests
- Invoice flow acceptance:
  - draft create/update/finalise works
  - finalised invoice immutability blocks illegal mutations
- Timeline acceptance:
  - canonical event keys + versioning are emitted and enforced
  - legacy-read compatibility remains intact
- Jobs acceptance:
  - CRUD operations work
  - job-document/invoice linkage works with deterministic duplicate conflict behavior
  - scheduling/assignment fields persist correctly
  - invalid status transitions return deterministic conflict behavior
- Search acceptance:
  - jobs/invoices/customers/documents remain queryable via existing search surface

## Validation Gates
Milestone 01 validation requires all commands to pass:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Current Milestone Snapshot
- Milestone state: Implemented (Slices 1-6 complete)
- Current implemented slice: Slice 6 — Jobs Workflow Foundation
- Current branch: `cursor/ai-invoicing-foundation-19d3`
- Current commit at plan creation: `7fb970097c49bde8a67c3dd1f21c24c024c184bc`
- Next slice: `TBD`

## Cross-References
- Roadmap: `docs/ROADMAP.md`
- Architecture blueprint: `docs/VISION_AND_ARCHITECTURE.md`
- Module readiness: `docs/MODULE_READINESS_MATRIX.md`
