# ABoss Platform Integration

Status: production implementation, 2026-07-14

The Invoicing application is a backend domain service for the native ABoss
Invoicing module. It is not a separately branded product entry point. The
browser remains on `https://aboss.au/invoicing` and all end-user authentication
is performed by ABoss.

## Production contract

ABoss calls the Invoicing API server to server. Each request includes a body
digest, timestamp, nonce, ABoss user and organisation context, and an HMAC
signature created with a deployment-specific shared secret. The service
rejects stale timestamps, replayed nonces, body mismatches, invalid signatures
and, when configured, an unexpected organisation.

Required production variables are:

- `ABOSS_ONLY_AUTH=1`
- `ABOSS_INTEGRATION_SECRET`
- `ABOSS_INTEGRATION_ACTOR_USER_ID`
- `ABOSS_ALLOWED_ORGANIZATION_ID` when a deployment is dedicated to one ABoss
  organisation

The integration actor is a dedicated local service identity used for database
audit ownership. It is not an interactive user credential. Health endpoints
remain available for deployment probes; business endpoints require the signed
ABoss contract when `ABOSS_ONLY_AUTH=1`.

## Owned workflows

The service owns customer records, quote lifecycle and conversion, invoice
drafting and finalisation, payments, reporting read models and the business
profile. ABoss owns their user-facing routes and UI. This preserves the
Invoicing schema, migrations, credentials and deployment boundary without
creating a second sign-in or exposing the service host to users.
