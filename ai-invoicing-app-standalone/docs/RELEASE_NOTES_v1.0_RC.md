# Release Notes — v1.0 Release Candidate

## Release Summary
This release candidate marks completion of foundational and hardening slices through Slice 49, including deterministic API contracts, operational readiness, security hardening, resilience validation, stress validation, full regression audit, and final end-to-end acceptance validation.

## Included in v1.0 RC
- Deterministic document lifecycle platform across:
  - Customers, Invoices, Credit Notes, Customer Payments, Statements
  - Suppliers, Purchase Orders, Supplier Bills, Supplier Payments
  - Jobs, Teams, Users/Roles
- Platform-wide deterministic behavior for:
  - Timeline/audit ordering and taxonomy integrity
  - Search integrity and cross-document references
  - Reporting/read-model integrity
  - API contract and error determinism
  - Backup/restore snapshot parity
  - Concurrency, idempotency, rollback safety, and resilience validation
- Production operations capabilities:
  - health/live/ready/diagnostics endpoints
  - structured logging and diagnostics
  - release smoke test command
  - deployment/rollback checklist documentation

## Release Validation
- Mandatory gates:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npm run smoke:release`
  - `npm audit`
- Final acceptance:
  - Slice 48 clean-db production-style acceptance walkthrough completed and passed.

## Known Limitations (RC)
- Single-tenant organization guardrail model (`ORGANIZATION_ID`) is implemented; full multi-tenant partitioning is not implemented.
- SQLite persistence is retained for v1.0 RC.
- Header-based actor identity model (`x-actor-user-id`) remains the current authentication mechanism.
- AI assistant capabilities remain intentionally out of foundational runtime scope.
