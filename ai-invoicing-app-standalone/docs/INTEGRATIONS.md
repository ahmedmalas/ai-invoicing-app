# Integrations (Standalone-First Policy)

## Principle
The platform must work standalone first. Integrations are optional extensions and must not block core workflows.

## Target Integrations

Accounting and tax ecosystem:
- MYOB
- Xero
- QuickBooks
- Reckon
- ATO-ready exports/reports and future official ATO integrations where legally supported and user-authorized

Storage and productivity ecosystem:
- Google Drive
- OneDrive
- Dropbox
- Microsoft 365
- Google Workspace
- Email import
- Future app marketplace

Export formats:
- CSV
- Excel
- PDF

## Integration Guardrails
- Use explicit user authorization and revocation controls.
- Preserve standalone data portability and document vault independence.
- Keep fallback export paths available when API connections fail.
