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

## Live Bank Feeds / Open Banking (Not implemented)

**Current product state (binding):** Live bank feeds do **not** exist in this Aleya workspace.

| Capability | Status |
|---|---|
| Bank feeds / open-banking providers | Not implemented |
| Connected bank accounts | Not implemented |
| Transaction synchronisation | Not implemented |
| Connection / last-sync / sync errors | Not implemented |
| Expired consent | Not implemented |
| Imported bank transactions | Not implemented |
| Bank reconciliation | Not implemented |
| Provider webhooks / background sync jobs | Not implemented |
| Static BSB/account on invoice templates | Exists (payment instructions on PDFs only) |
| Manual customer payment recording | Exists (`/payments`) |

Do **not** confuse template bank details or “Bank transfer” payment methods with a live bank-feed connection.

### Aleya AI behaviour
- Tool: `get_bank_feed_status` returns `implemented: false` / not connected.
- Answers “Is my bank feed connected?” with: bank feeds are not currently implemented — no live connection to verify.
- Must not call `get_business_profile` for bank-feed questions.
- Must not invent a bank-feed settings page.

### Implementation plan (P1)
1. Choose open-banking provider strategy (see `TECH_DECISIONS.md`).
2. Persist connections, consent, sync health, and imported transactions.
3. Add secure reconnect/disconnect flows + webhooks.
4. Register Aleya tools: `list_connected_bank_accounts`, `get_bank_feed_sync_health`, `list_recent_bank_transactions`, `refresh_bank_feed`, `disconnect_bank_feed` (confirm), `reconnect_bank_feed`.
5. Matching inputs: amount, reference, payer name, invoice number, and confidence thresholds; Needs Review when uncertain.
