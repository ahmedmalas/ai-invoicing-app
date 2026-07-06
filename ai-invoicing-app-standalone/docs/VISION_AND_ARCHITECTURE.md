# Vision and Architecture

## Project Vision
Build a standalone AI Invoicing / AI Business OS platform that is document-first, invoice-capable, auditable, and extensible via controlled slice-based delivery.

## Product Objectives
- Deliver reliable document and invoicing workflows with deterministic backend behavior.
- Preserve auditability through immutable timeline/event history.
- Keep architecture modular so future modules can be added without redesigning core foundations.
- Enforce high engineering quality via mandatory validation gates.

## Current Project Snapshot
- Current branch: `cursor/ai-invoicing-foundation-19d3`
- Current commit (at doc creation): `0dd37e679b31b8d0183759bc13ed2d37486a7969`
- Current implemented slice: **Slice 6 — Jobs Workflow Foundation**
- Documentation baseline:
  - `docs/ROADMAP.md`
  - `docs/BUILD_LOG.md`
  - `docs/DOCUMENTATION_GOVERNANCE.md`
  - `docs/PROJECT_OPERATING_MANUAL.md`
- Validation status: baseline currently passing required gates; re-validated during this documentation task.

## High-Level Architecture
- Monolith-first service architecture with clear domain boundaries.
- Fastify API layer for request handling and transport concerns.
- Domain modules for validation, workflow rules, and business behavior.
- SQLite persistence with schema constraints and triggers for integrity guarantees.
- Timeline taxonomy as cross-cutting audit substrate.
- Search as cross-entity platform capability.

## Core Design Principles
- Document-first platform orientation.
- Deterministic behavior over implicit behavior.
- Explicit validation at API and domain boundaries.
- Immutable audit history for meaningful state changes.
- Incremental slice delivery over speculative big-bang implementation.
- Documentation and architecture governance as first-class engineering assets.

## Technology Stack
- Runtime: Node.js + TypeScript
- API: Fastify + Zod validation
- Persistence: SQLite (`better-sqlite3`) with migration-safe startup adjustments
- Testing: Vitest (unit, integration, e2e), coverage reporting
- Build/Lint: TypeScript compiler + ESLint

## Module Boundaries
- `customers`: customer profile lifecycle and references.
- `invoices`: draft/finalise lifecycle, totals, numbering, immutability protections.
- `jobs`: job lifecycle, status workflow, scheduling/assignment, document linkage.
- `documents`: normalized document records and searchable metadata.
- `timeline`: canonical event taxonomy/versioning and immutable history.
- `search`: cross-entity query surface returning bounded result sets.
- `preferences` / `business_profile`: branding and runtime preferences.

## Data Flow
1. Request enters route layer and is schema-validated.
2. Domain-level workflow rules are enforced.
3. Persistence writes execute with DB constraints/triggers as final guardrails.
4. Timeline events are emitted for canonical audit history.
5. Searchable artifacts/documents are updated where applicable.
6. Deterministic API response is returned.

## Validation Philosophy
- Validate early (request schemas), validate centrally (domain transitions), and validate finally (DB integrity constraints).
- Treat invalid workflow transitions and immutable-entity mutation attempts as deterministic conflicts.
- Keep tests layered:
  - Unit: schema/rule correctness
  - Integration: persistence and module behavior
  - E2E: route-to-database behavior

## Security Principles
- Minimize implicit trust between layers.
- Enforce data integrity and immutability at DB level where required.
- Use explicit status transition controls for workflow safety.
- Preserve auditable action history through timeline events.
- Keep module boundaries clear to reduce accidental privilege bleed across domains.

## AI Integration Philosophy
- AI is additive, not foundational to core correctness.
- Core workflows (invoicing, jobs, status transitions, persistence integrity) remain fully deterministic without AI.
- Future AI capabilities must be bounded by explicit validation, auditability, and user-control constraints.
- Unknown AI-enabled module details remain **TBD** until formally sliced.

## Future Expansion Strategy
- Expand via approved slices only; avoid organic architecture drift.
- Keep unplanned slices as placeholders until scope and risks are explicitly defined.
- Reuse existing foundations (timeline taxonomy, search substrate, modular boundaries) when introducing new modules.
- Maintain backward compatibility and migration safety as expansion requirements.

## Engineering Standards
- Required gates for every non-trivial change:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`
- No scope creep beyond approved slice boundaries.
- Deterministic errors for deterministic rule violations.
- Documentation must be updated when architecture-affecting behavior changes.

## Slice-Based Development Methodology
- Plan one slice with explicit in-scope and out-of-scope boundaries.
- Implement only approved scope.
- Add/adjust tests with deterministic assertions.
- Run full gate sequence and fix failures before completion.
- Record completion in roadmap/build log with commit traceability.

## Cross-References
- Planning index: `docs/ROADMAP.md`
- Chronological implementation record: `docs/BUILD_LOG.md`
- Documentation policy: `docs/DOCUMENTATION_GOVERNANCE.md`
- Engineering workflow/gates: `docs/PROJECT_OPERATING_MANUAL.md`
