# Production Operations Runbook

## Purpose
Define operational procedures for deploying, validating, and troubleshooting AI Business OS in production.

## Runtime Configuration
Required/validated environment variables:
- `PORT` (default `3000`)
- `DB_PATH` (default `./data/slice1.db`)
- `NODE_ENV` (`development | test | production`)
- `LOG_LEVEL` (`trace | debug | info | warn | error | fatal | silent`)
- `SERVICE_NAME` (default `ai-business-os`)
- `ORGANIZATION_ID` (default `single-tenant`)
- `DB_BUSY_TIMEOUT_MS` (1000-60000, default `5000`)
- `ENABLE_STRUCTURED_LOGGING` (`1` or `0`, default `1`)
- Production template: `.env.production.example`

## Startup Procedure
1. Ensure writable parent directory exists for `DB_PATH`.
2. Start service:
   - `npm run build`
   - `npm run start`
3. Confirm service binds successfully and emits structured startup/request logs.
4. Run deterministic release smoke:
   - `npm run smoke:release`

## Health Checks
Public endpoints:
- `GET /health` -> liveness (`{ "status": "ok" }`)
- `GET /health/live` -> liveness duplicate for infra compatibility
- `GET /health/ready` -> readiness with DB checks:
  - schema compatibility (`user_version` vs expected schema version)
  - `PRAGMA quick_check = ok`
  - `PRAGMA foreign_keys = ON`

Admin-only endpoint:
- `GET /health/diagnostics` (requires admin actor header `x-actor-user-id`)
  - request metrics
  - process metadata (pid/node/memory/uptime)
  - DB diagnostics (`journal_mode`, `busy_timeout`, schema compatibility)
  - backup/restore metadata (snapshot version and table coverage)

## Logging Standards
Structured logs are emitted for:
- Request lifecycle:
  - `request.received`
  - `request.completed`
- Failure categories:
  - `authorization.failure`
  - `validation.failure`
  - `database.failure`
  - `runtime.unexpected_error`

Each event should include request identifiers (`requestId`, `method`, `url`) where applicable.

## Backup and Restore Operations
Endpoints:
- `GET /platform/backup` (admin-only)
- `POST /platform/restore` with `{ "snapshot": ... }` (admin-only)

Operational procedure:
1. Capture backup from source instance.
2. Restore into an empty target instance only.
3. Validate:
   - `GET /health/ready` returns `ready`
   - `GET /platform/backup` on target matches source snapshot
4. Validate business read parity by sampling:
   - `/reports/read-model`
   - `/search`
   - `/timeline/:entityType/:entityId`

## Migration and Version Compatibility
- Startup enforces schema compatibility using SQLite `PRAGMA user_version`.
- If `user_version` is newer than supported schema version, startup fails with deterministic compatibility error.
- If older, startup upgrades `user_version` to current expected value after migration/bootstrap logic.

## Operational Smoke Test Checklist
1. `GET /health` = 200
2. `GET /health/live` = 200
3. `GET /health/ready` = 200 + `status=ready`
4. `GET /health/diagnostics`:
   - 401 without auth
   - 200 for admin user
5. Trigger validation failure and confirm `validation.failure` log event
6. Trigger authorization failure and confirm `authorization.failure` log event
7. Execute backup/restore cycle and verify `ready` + snapshot parity post-restore

## Graceful Shutdown Procedure
1. Send `SIGTERM` to the running process.
2. Wait for process exit and verify no open listener remains on the service port.
3. Restart service and re-check `/health/ready`.

## Incident Response
1. Check `/health/ready` first for immediate DB/readiness status.
2. Pull `/health/diagnostics` for metrics and runtime state.
3. Inspect structured logs by request id and failure event type.
4. If database integrity concern exists, inspect `quick_check` and perform controlled backup.
5. If restore is needed, restore only into empty target, then verify parity before cutover.
