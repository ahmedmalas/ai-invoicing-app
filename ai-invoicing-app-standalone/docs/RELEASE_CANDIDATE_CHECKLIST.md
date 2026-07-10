# Release Candidate Checklist (v1.0 RC)

## Objective
Track deterministic release-readiness checks for deployment and rollback.

## Deployment Readiness Checklist
- [ ] Production environment variables configured from `.env.production.example`.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run smoke:release` passes against a clean SQLite database.
- [ ] `GET /health`, `GET /health/live`, and `GET /health/ready` return healthy status.
- [ ] `GET /health/diagnostics` is admin-only.
- [ ] Backup and restore procedures are validated in target environment.
- [ ] Structured logs are visible and include request lifecycle + failure-class events.

## Rollback Readiness Checklist
- [ ] A verified backup snapshot exists before deployment.
- [ ] Rollback target artifact (previous release commit/build) is pinned.
- [ ] Restore procedure to empty target database is validated.
- [ ] Post-rollback health checks (`/health`, `/health/ready`) are validated.
- [ ] Post-rollback parity checks for search/reporting/timeline are validated.

## Known Limitations (RC Scope)
- Single-tenant organization guardrail model (`ORGANIZATION_ID`) is implemented; full multi-tenant partitioning is not implemented.
- SQLite remains the persistence engine; write concurrency relies on transactional safety and busy-timeout behavior.
- Authentication is header-based actor identity (`x-actor-user-id`) and is intended for controlled deployment environments.
- AI assistant features remain intentionally out of foundational scope.
