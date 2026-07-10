# Production Operations Runbook

## Purpose
Define operational procedures for deploying, validating, and troubleshooting AI Business OS in production.

## Runtime Configuration
Required/validated environment variables:
- `DATABASE_URL` (required; pooled PostgreSQL URI, secret)
- `DB_POOL_MAX` (1-20, default `5`)
- `NODE_ENV` (`development | test | production`)
- `LOG_LEVEL` (`trace | debug | info | warn | error | fatal | silent`)
- `SERVICE_NAME` (default `ai-business-os`)
- `ORGANIZATION_ID` (default `single-tenant`)
- `ENABLE_STRUCTURED_LOGGING` (`1` or `0`, default `1`)
- `CORS_ORIGIN` (default `https://ai-invoicing-app.vercel.app`)
- `REQUEST_BODY_LIMIT` (1024-10485760, default `1048576`)
- Production template: `.env.production.example`

## Startup Procedure
1. Confirm pooled `DATABASE_URL` is configured without logging its value.
2. Start local/service deployment:
   - `npm run build`
   - `npm run start`
3. Vercel imports `api/index.ts` and does not call `listen()`.
4. Confirm service emits structured request logs and reports PostgreSQL readiness.
5. Run deterministic release smoke:
   - `npm run smoke:release`

## Health Checks
Public endpoints:
- `GET /health` -> liveness (`{ "status": "ok" }`)
- `GET /health/live` -> liveness duplicate for infra compatibility
- `GET /health/ready` -> readiness with DB checks:
  - PostgreSQL connection
  - schema metadata compatibility
  - foreign-key/constraint availability

Admin-only endpoint:
- `GET /health/diagnostics` (requires admin actor header `x-actor-user-id`)
  - request metrics
  - process metadata (pid/node/memory/uptime)
  - DB diagnostics (PostgreSQL backend, pool health, schema compatibility)
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
- Startup applies the idempotent PostgreSQL schema under an advisory transaction lock.
- `app_database_metadata` records the supported schema version.
- A newer unsupported version fails startup with `DB_SCHEMA_VERSION_UNSUPPORTED`.
- Existing SQLite/snapshot data can be migrated with `npm run migrate:postgres`.

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
4. If database integrity concern exists, inspect readiness/schema metadata and perform controlled snapshot export.
5. If restore is needed, restore only into empty target, then verify parity before cutover.
