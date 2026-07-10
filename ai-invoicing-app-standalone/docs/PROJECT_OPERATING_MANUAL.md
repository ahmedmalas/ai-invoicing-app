# Project Operating Manual

## Purpose
Define the engineering workflow, validation gates, and operational rules for this repository.

## Current Runtime Baseline
- Implemented through: **Slice 6 — Jobs Workflow Foundation**
- Baseline commit: `3ca48a2ad4d29f3e1a733a808b91758136496cfc`
- Working branch at manual creation: `cursor/ai-invoicing-foundation-19d3`

## Standard Slice Workflow
1. Confirm scope and out-of-scope boundaries.
2. Implement only approved slice work.
3. Update documentation (roadmap/build log/decisions) as needed.
4. Run validation gates.
5. Fix failures and re-run gates until clean.
6. Commit the slice with a deterministic message.

## End of Every Slice (Mandatory)
Complete all steps in order before closing a slice:
1. Verify validation gates pass:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
2. Confirm working tree state and capture status output.
3. Create slice completion commit.
4. Update `docs/ROADMAP.md`.
5. Update `docs/BUILD_LOG.md`.
6. Update `docs/MODULE_READINESS_MATRIX.md` if the slice impacts module readiness.
7. Update `docs/SESSION_HANDOFF.md` (or current project-equivalent handoff document when `SESSION_HANDOFF.md` does not exist).
8. Record commit hash.
9. Record current branch.
10. Record validation results.

## Slice Completion Report Template (Standard)
Every future implementation report must use this template.

### Slice Completion Report
- Slice number/name:
- Summary:
- Files created:
- Files modified:
- Tests added/updated:
- Validation results:
  - `npm run typecheck`:
  - `npm run lint`:
  - `npm test`:
  - `npm run build`:
- Git status:
- Commit hash:
- Known risks:
- Next recommended slice:

## Before Starting the Next Slice (Mandatory Checklist)
- Review `docs/ROADMAP.md`.
- Review latest `docs/BUILD_LOG.md` entry.
- Review `docs/SESSION_HANDOFF.md` (or project-equivalent handoff document).
- Verify current branch.
- Verify current commit.
- Confirm dependencies are complete.
- Confirm requested scope matches planned slice boundaries.

## Validation Gates (Required)
Run in repository root:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

All four gates must pass before a slice is considered complete.

## Deterministic Error and Validation Rules
- Enforce domain rules server-side.
- Prefer explicit, stable error identifiers/messages for conflict scenarios.
- Keep validation close to route and domain boundaries.

## Branch and Commit Discipline
- Keep changes scoped to the active slice.
- Use one logical commit per slice completion when practical.
- Include slice identity in commit message.
- Record resulting commit in roadmap/build log when it changes project baseline.

## Documentation Operating Rules
- Do not leave roadmap/build log stale after slice completion.
- Do not add detailed plans for unapproved future slices.
- Keep this repository’s docs independent from other projects.
- Use the standard Slice Completion Report template for all future implementation reports.

## Out-of-Scope Guardrail
For documentation-baseline tasks:
- do not modify application behavior
- do not introduce unrelated refactors
- do not couple this project to inventory project artifacts
