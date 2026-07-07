# AI Invoicing / AI Business OS Roadmap

## Purpose
This roadmap is the canonical planning index for implementation slices in this repository. It records what is implemented, what is approved, and what is intentionally unplanned.

## Current Implemented Baseline
- Current implemented slice: **Slice 31 — Document Number Sequence Integrity**
- Baseline commit: `6494103598038d81a2ef0f9ae7f9f96419f74093`
- Active branch at roadmap update: `cursor/slice-31-document-number-sequence-integrity-19d3`

## Completed Slices (Canonical History)
1. **Slice 1 — Invoice Vertical Foundation** (implemented)
2. **Slice 2 — DB-Level Finalised Invoice Immutability** (implemented)
3. **Slice 3 — Timeline Event Taxonomy + Versioning** (implemented)
4. **Slice 4 — Jobs Entity Foundation** (implemented)
5. **Slice 5 — Job Documents + Invoice Linkage** (implemented)
6. **Slice 6 — Jobs Workflow Foundation** (implemented)
7. **Slice 7 — Users/Roles Foundation + Job Assignment Integrity** (implemented)
8. **Slice 8 — Teams Membership Foundation + Assignment Scope Controls** (implemented)
9. **Slice 9 — Team Membership Lifecycle Integrity** (implemented)
10. **Slice 10 — Team Deletion Integrity** (implemented)
11. **Slice 11 — Team Assignment Audit + Reconciliation** (implemented)
12. **Slice 12 — Team Permissions Foundation** (implemented)
13. **Slice 13 — Team Role Authorization Foundation** (implemented)
14. **Slice 14 — Final Invoice Search/Filtering Baseline** (implemented)
15. **Slice 15 — Final Invoice Audit Trail + Query Readiness** (implemented)
16. **Slice 16 — Customer Statement Engine (Read-Only)** (implemented)
17. **Slice 17 — Statement Audit & Export Hardening** (implemented)
18. **Slice 18 — Invoice Credit Notes (Lifecycle-Safe)** (implemented)
19. **Slice 19 — Customer Payments (Allocation Without Ledger)** (implemented)
20. **Slice 20 — Supplier Bills (Accounts Payable Foundation)** (implemented)
21. **Slice 21 — Supplier Bill Payments (Accounts Payable Payments)** (implemented)
22. **Slice 22 — Purchase Orders (Procurement Foundation)** (implemented)
23. **Slice 23 — Supplier Bill Creation from Purchase Orders** (implemented)
24. **Slice 24 — Purchase Order Billing Status & Partial Conversion** (implemented)
25. **Slice 25 — Purchase Order Closure Guardrails** (implemented)
26. **Slice 26 — Supplier Bill Linking Guardrails from Purchase Orders** (implemented)
27. **Slice 27 — Supplier Bill Amendments (Draft-Only Revision Safety)** (implemented)
28. **Slice 28 — Supplier Bill Finalisation Readiness** (implemented)
29. **Slice 29 — Supplier Bill Finalisation Timeline & Regression Hardening** (implemented)
30. **Slice 30 — Supplier Bill Payment Readiness & Linkage Guardrails** (implemented)
31. **Slice 31 — Document Number Sequence Integrity** (implemented)

## Approved Next Work
- **No future slice is locked at this time.**
- Future slices remain placeholders until explicitly planned and approved in-repo.

## Future Slice Placeholders (Unplanned)
- Slice 32 — TBD (placeholder only)
- Slice 33 — TBD (placeholder only)
- Slice 34 — TBD (placeholder only)

## Roadmap Update Rules
- Update this file only when a slice is planned, implemented, or superseded.
- Do not pre-fill speculative implementation details for unplanned slices.
- Every completed slice entry must include:
  - slice name
  - implementation state
  - completion commit hash
  - validation gate result summary
