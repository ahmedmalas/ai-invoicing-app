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

## Live Bank Feeds / Open Banking (Future)
- Feature class: advanced/future.
- Requires user authorization and jurisdiction/provider support.
- Matching inputs: amount, reference, payer name, invoice number, and AI confidence.
- Auto-paid requires confidence + rule thresholds; else mark Needs Review.
- Manual confirmation remains fallback.
