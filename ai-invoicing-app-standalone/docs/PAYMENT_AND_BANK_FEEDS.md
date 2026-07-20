# Payment Centre and Bank Feeds

## Payment Centre Baseline

Supported payment channels target:
- Bank transfer
- Stripe
- Square
- eWAY
- PayPal
- Cash
- Cheque
- Other

Customer portal payment declaration:
- "I've Paid" action with payer name, amount, payment date, reference number, bank, notes, and receipt upload (image/PDF).
- Owner receives notification and can approve or reject.
- All actions are logged for auditability.

## Reminder and Truthfulness Rules
- Reminders are configurable (3/7/14/30 days or custom).
- Reminders stop when payment is approved, confidently detected, or manually marked paid.
- If status is uncertain, system must avoid asserting non-payment as fact.

## Bank Reconciliation (Shipped)

Authenticated Banking workspace (`/workspace/reconciliation`):
- Create bank accounts (manual connection entry with institution / masked BSB & account).
- Import CSV, OFX/QFX, or QIF statements with fingerprint-based duplicate detection.
- Transaction list with status filters (unmatched / suggested / matched / ignored).
- Confidence matching against open invoices; high-confidence credits auto-create customer payments.
- Approve suggestions, manual match, ignore, and unmatch (reconcile / unreconcile).
- Audit history for import, match, suggest, approve, ignore, and unmatch actions.

## Live Bank Feeds / Open Banking (Future)
- Feature class: advanced/future provider sync (Plaid / Basiq / etc.).
- Schema reserves `external_account_id` / `connection_id` / `source=open_banking`.
- Requires user authorization and jurisdiction/provider support.
- Matching inputs: amount, reference, payer name, invoice number, and AI confidence.
- Auto-paid requires confidence + rule thresholds; else mark Needs Review.
- Manual confirmation remains fallback.
