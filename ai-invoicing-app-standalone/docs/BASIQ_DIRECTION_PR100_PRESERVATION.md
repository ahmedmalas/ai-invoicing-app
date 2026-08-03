# Basiq direction change — PR #100 preservation + blocker audit

**Date:** 2026-08-03  
**Production tip / return point:** `d07397563c77892ebe9b179d6ae0c23cfb833dbf`  
**Schema on production:** PostgreSQL **47** (schema **48** must not run)  
**Decision:** Basiq remains the intended bank-feed provider (Redbark confirmed it cannot cover multi-tenant SaaS customer bank connections; recommended a CDR provider such as Basiq or Adatree).

This document preserves the audit findings from draft PR #100
(`cursor/retire-basiq-bank-feeds-7128` @ `323f8fb6c708f9e5635c319cc8ce6fbcd58b5066`)
and records the post-decision investigation. It does **not** claim Basiq is fixed
or accepted.

---

## 1. Preserved findings from PR #100 (do not execute)

PR #100 intended to **retire** Basiq and reset Bank Feeds to an unconfigured
placeholder. That direction is **superseded**. Keep the PR **unmerged and
undeployed**. Do **not** apply its data-destructive migration.

### What PR #100 would have done (historical record only)

| Area | Planned change |
|---|---|
| UI | Neutral “Bank feeds are not connected yet” + disabled Connect |
| API | Connect / refresh / disconnect / webhook → `410` |
| Code | Delete Basiq client, AuthLink/consent, phone, sync, hosted-failure modules |
| Postgres | Schema **48** on boot when DB &lt; 48 |
| Schema 48 SQL | `DELETE FROM public.basiq_connect_states`; scrub `bank_connections` provider/consent/mobile → `disconnected` |
| Runtime | `/banking/status` → `clearRetiredBankFeedProviderState()` even after schema ≥ 48 |
| Invoices / payments / business | Untouched |
| Safety gate | Preview unsafe if Preview shares Production Postgres (auto-applies schema 48 on boot) |

### Explicitly forbidden going forward

1. Do **not** merge or deploy PR #100.  
2. Do **not** run PostgreSQL schema 48.  
3. Do **not** scrub, delete, or disconnect existing Basiq connection, consent, or mobile state.  
4. Do **not** remove the Basiq integration from the codebase.  
5. Do **not** write speculative app patches until Basiq dashboard enablement is audited.

### Overlap note (still relevant)

PR #100 overlapped open PR #99 (`cursor/initial-load-performance-7128`) on:

- `ai-invoicing-app-standalone/public/app.js`
- `ai-invoicing-app-standalone/src/db/postgres-database.ts`

---

## 2. Current production Basiq architecture (`d073975`)

Production `/health/ready` reports `appCommitSha=d073975…` and `schemaVersion=47`.

### Runtime shape

```
Browser (Settings → Bank Feeds / Banking UI)
  → POST /api/banking/connect (Aleya session)
  → startBasiqConnect()
       ├─ SERVER_ACCESS token (Basic API key) for users/consents/auth_link
       ├─ Persist bank_connections + public.basiq_connect_states
       ├─ If existing Basiq user (and not freshConsent/changeMobile):
       │     CLIENT_ACCESS token bound to userId
       │     → https://consent.basiq.io/home?token=…&action=connect&state=…
       │       (+ institutionId=AU00000 when BASIQ_ENVIRONMENT is sandbox)
       └─ Else first-time / freshConsent / changeMobile:
             POST /users/{id}/auth_link (mobile for SMS 2FA)
             → open AuthLink public URL (+ state)
  → Hosted Basiq Consent UI / AuthLink
  → Redirect URL → /api/banking/basiq/callback?state=…
  → completeBasiqCallback → syncBankConnection
  → GET /api/banking/status (+ hosted-error classification)
```

### Key modules (kept)

- `src/services/basiq-client.ts` — `/token` (SERVER_ACCESS + CLIENT_ACCESS), users, consents, auth_link, institutions, jobs, webhooks  
- `src/domain/banking/connection-service.ts` — launch mode + `action=connect` Consent UI  
- `src/domain/banking/basiq-errors.ts` — classifies “Connections not enabled” / `access-denied`  
- `src/domain/banking/hosted-failure.ts` — job/hosted failure reconciliation  
- `src/routes/banking.ts` — connect / callback / status / health / report-hosted-error  
- Env (names only): `BASIQ_API_KEY`, `BASIQ_ENVIRONMENT`, `BASIQ_API_BASE_URL`, `BASIQ_API_VERSION`, `BASIQ_WEBHOOK_SECRET`

### Consent UI usage (code already matches current Basiq docs)

For an existing provider user, production code:

1. Obtains a **user-bound `CLIENT_ACCESS`** token via `POST /token` with `scope=CLIENT_ACCESS&userId=…`.  
2. Redirects to `https://consent.basiq.io/home` with `token`, **`action=connect`**, and Aleya `state`.  
3. In sandbox, also passes `institutionId=AU00000` (Hooli OB).

Basiq docs currently recommend `action=connect` for connecting institutions (including preferred onboarding clarity).

---

## 3. Observed remaining blocker (provider-side)

### What already worked in Aleya

- Aleya reached the Basiq hosted flow.  
- Ahmed’s saved Australian mobile appeared (AuthLink / stored `auth_link_mobile` path).  
- Flow then bounced back or failed inside Basiq hosted UI.

### Prior classification (application evidence)

Hosted UI failure was classified as:

- Title / detail: **Connections not enabled**  
- Code: **access-denied**  
- Stable Aleya code: `BASIQ_CONNECTIONS_NOT_ENABLED`

Basiq changelog and HTTP error docs describe this as a **partner API key / application enablement** issue (“Connections not enabled for a specific partner API key”; “Please contact us to have your API key enabled for Connections”), **not** a bad mobile number and **not** an invalid `/token` API key.

### Separation

| Class | Examples | Owner |
|---|---|---|
| **Dashboard / account enablement** | Connections product off; sandbox-only key; OB not enabled; institutions not selected; wrong Redirect URL; Brand/Consent UI incomplete | Ahmed + Basiq Support |
| **Application-code defects** | Wrong token scope; wrong Consent action; missing state; incorrect callback route | Engineering — **only after** enablement audit proves a code mismatch |

**Current conclusion:** The remaining blocker is **provider/dashboard enablement** until Basiq Support / Dashboard audit proves otherwise. No speculative code patch in this pass.

---

## 4. Exact Basiq dashboard configuration Ahmed must complete

Work in [dashboard.basiq.io](https://dashboard.basiq.io) on the **same application** that issued the API key stored in Vercel `BASIQ_API_KEY`.

### A. Connections product / live enablement (primary blocker)

1. Confirm the application/API key is **enabled for Connections**.  
2. If Consent UI shows **“Connections not enabled” / `access-denied`**, contact **Basiq Support / Customer Success** and request enablement for that application/API key (sandbox Connections and/or live data as required).  
3. Do **not** mint a new API key unless Basiq confirms the current application cannot be enabled.  
4. Align Vercel `BASIQ_ENVIRONMENT`:
   - `sandbox` → test with Hooli (`AU00000`) only after sandbox Connections work.  
   - `production` → only after Basiq enables live data for this application.

### B. Open Banking enablement (if targeting CDR OB institutions)

1. Application must use API **v3.0** (`basiq-version: 3.0` — already used by Aleya).  
2. OB enablement is **application-level** and done with Basiq Customer Success (CDR attributes: accreditation type, entity name, licence number).  
3. Until enabled, the Institutions picker will not expose OB methods for many banks.

### C. Consent policy (Customise UI)

Configure for the Aleya application:

- Duration / data retrieval span  
- Title & subtitle  
- Purposes  
- Permissions / scopes  
- Supporting parties  
- Manage Consent URL (public guide for revoking consent)

### D. Enabled institutions

- Select institutions end users may connect.  
- For sandbox verification: ensure **Hooli OB (`AU00000`)** is available and method is **open-banking**.  
- For live: select intended AU institutions and connection method (OB vs DDC) after enablement.

### E. Brand Name / Consent UI branding

- Brand / header image and display name shown in Consent UI.  
- Preview Consent UI from Customise UI before asking end users to connect.

### F. Redirect / callback URL

Must match Aleya production callback exactly:

`https://ai-invoicing-app.vercel.app/api/banking/basiq/callback`

(Aleya also attaches a high-entropy `state` query param.)

### G. Allowed environment

- Separate Basiq applications (recommended) for sandbox vs production.  
- Ensure the Vercel `BASIQ_API_KEY` belongs to the application you just configured.  
- Ensure `BASIQ_ENVIRONMENT` matches that application’s intended mode.

### H. API key / application pairing

- Key must be from the enabled application.  
- Store verbatim in Vercel Production `BASIQ_API_KEY` (Basic auth uses key as issued; do not Base64-encode).  
- Optional: `BASIQ_WEBHOOK_SECRET` if webhooks are configured for the same app.

### I. Manual verification checklist (Ahmed)

1. In Dashboard Customise UI live preview, open Consent UI with a test user — confirm it does **not** show “Connections not enabled”.  
2. From Aleya production Bank Feeds, connect again.  
3. Confirm hosted flow completes and callback returns to Aleya with a connected/syncing status.  
4. Only then consider any residual Aleya code defects.

---

## 5. Code corrections remaining after dashboard audit

**None proposed in this pass.**

Already present and aligned with current Basiq docs:

- User-bound `CLIENT_ACCESS` token for Consent UI  
- `action=connect` for existing users / connect path  
- AuthLink + mobile for first-time / freshConsent / changeMobile  
- Classification of Connections-not-enabled as dashboard enablement  
- Required Redirect URL messaging in connect responses  

Possible **future** code work only if dashboard audit proves a mismatch (examples, not to implement now): always use Consent UI even for first-time users; Manage Consent URL deep-link; environment detection improvements.

---

## 6. Status snapshot

| Item | Status |
|---|---|
| PR #100 | Superseded / closed; unmerged; must stay undeployed |
| Schema 48 | **Not applied**; must not run |
| Production commit | `d07397563c77892ebe9b179d6ae0c23cfb833dbf` |
| Production schema | **47** |
| Basiq integration in codebase | **Retained** on production tip |
| Basiq connection/consent/mobile state | **Must not be scrubbed** |
| Fix claim | **Not fixed / not accepted** — Ahmed must complete dashboard enablement and physically retest |
