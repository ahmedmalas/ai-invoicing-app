# Shared ALEYA Logo Creator Platform

Status: implemented 2026-07-18

## Principle

Logo Creator is **both**:

1. A standalone product (`ahmedmalas/ALEYA-LOGO-CREATOR`)
2. A built-in feature of Aleya Invoicing (`/logo-creator`)

ABoss and future modules open the same product. All three entry points share one
Supabase backend:

- Project: `aleya-logo-creator` (`wrmwthsfbpkjsxsqigpw`)
- Tables: `workspaces`, `logo_projects`, `logo_concepts`, `brand_kits`, `platform_links`, `integration_deliveries`
- Edge function: `logo-platform`

## Active Brand Kit delivery

When a user selects a logo / activates a Brand Kit:

1. Shared `brand_kits` row is marked `is_active`
2. `workspaces.active_brand_kit_id` is updated
3. Aleya Invoicing caches the mark on `business_profile.logo_reference` for UI/PDF delivery
4. Dashboard, settings, invoice workspace and PDFs read that active branding automatically

No manual download/re-upload between products.

## Historical invoices

On invoice finalisation, Aleya stores `{ invoice, branding, brandedAt }` in
`invoice_snapshots`. PDF generation for Finalised invoices prefers the frozen
branding snapshot so later Brand Kit changes do not rewrite issued documents.

## Environment (Invoicing)

```
LOGO_CREATOR_SUPABASE_URL=https://wrmwthsfbpkjsxsqigpw.supabase.co
LOGO_CREATOR_SERVICE_ROLE_KEY=...
# or
ALEYA_PLATFORM_SECRET=...
LOGO_CREATOR_ANON_KEY=...
LOGO_CREATOR_PUBLIC_URL=https://<standalone-host>
```

## ABoss entry

ABoss opens:

```
{LOGO_CREATOR_PUBLIC_URL}/?source=aboss&returnUrl=...&businessId=...
```

See `ALEYA-LOGO-CREATOR/integrations/aboss/` for the shell module patch. The ABoss
GitHub repository was not accessible from this agent environment; the launch
contract and drop-in patch are provided for application in that repo.
