# Documentation Governance

## Objective
Ensure project documentation stays accurate, auditable, and usable as an engineering control plane.

## Source-of-Truth Documents
- `docs/ROADMAP.md`: canonical slice state and planning index.
- `docs/BUILD_LOG.md`: chronological implementation and audit record.
- `docs/TECH_DECISIONS.md`: architectural and technical decision ledger.
- `docs/PRODUCT_PRINCIPLES.md`: product constitution and non-negotiable constraints.
- `docs/PROJECT_OPERATING_MANUAL.md`: engineering workflow and gate policy.

## Change Policy
- Documentation changes must be committed in the same branch as related implementation work.
- If behavior changes, docs must be updated in the same slice or explicitly marked pending.
- If no behavior changes, docs-only commits are allowed and preferred for governance updates.
- End-of-slice documentation updates are mandatory and cannot be skipped.

## Update Triggers
- A new slice starts or completes.
- Architecture or decision constraints change.
- Validation gates or test policy change.
- API contract or domain workflow changes.
- Branching/release workflow changes.

## End-of-Slice Documentation Synchronization (Mandatory)
At the end of every slice:
1. Confirm all validation gates passed.
2. Capture clean or expected working-tree status.
3. Commit the slice.
4. Update `docs/ROADMAP.md`.
5. Update `docs/BUILD_LOG.md`.
6. Update `docs/MODULE_READINESS_MATRIX.md` when module status/dependencies changed.
7. Update `docs/SESSION_HANDOFF.md` (or project-equivalent handoff document if `SESSION_HANDOFF.md` is absent).
8. Record commit hash.
9. Record current branch.
10. Record validation outcomes.

## Before-Next-Slice Review (Mandatory)
Before implementation starts for the next slice:
- Review `docs/ROADMAP.md`.
- Review latest `docs/BUILD_LOG.md` entry.
- Review `docs/SESSION_HANDOFF.md` (or project-equivalent handoff document).
- Verify branch and commit context.
- Confirm prerequisite dependencies are completed.
- Confirm requested scope aligns with planned slice boundaries.

## Standard Slice Completion Report (Required Format)
All future implementation reports must include:
- Slice number/name
- Summary
- Files created
- Files modified
- Tests added/updated
- Validation results
- Git status
- Commit hash
- Known risks
- Next recommended slice

## Quality Bar for Documentation
- Must be explicit, deterministic, and implementation-aligned.
- Must avoid speculative detail for unplanned work.
- Must identify current state (slice, commit, branch) when relevant.
- Must not depend on external project docs (inventory or other repos).

## Ownership and Review
- Engineering owner for active slice updates all affected docs.
- Reviewer checks:
  - roadmap correctness
  - build log completeness
  - decision consistency
  - workflow/gate alignment
- Docs are considered stale if code changed but governing docs did not.

## Versioning and Traceability
- Each material update should be traceable through git history.
- Completed slice records should reference commit hashes.
- Build and test gate results should be captured in slice reports and reflected in docs where needed.
