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

## Update Triggers
- A new slice starts or completes.
- Architecture or decision constraints change.
- Validation gates or test policy change.
- API contract or domain workflow changes.
- Branching/release workflow changes.

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
