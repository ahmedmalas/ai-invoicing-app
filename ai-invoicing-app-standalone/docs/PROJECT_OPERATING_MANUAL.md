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

## Out-of-Scope Guardrail
For documentation-baseline tasks:
- do not modify application behavior
- do not introduce unrelated refactors
- do not couple this project to inventory project artifacts
