# Features (Foundation Draft)

## AI Business OS Functional Areas

1. Personal + Business Document Platform
   - Create, upload, store, search, recreate, convert, brand, send, track, and manage documents.
   - Supported set includes documents, invoices, quotes, receipts, bills, statements, timesheets, delivery dockets, purchase orders, contracts, letters, forms, and custom documents.

2. Product Editions and Tiering
   - Personal Edition.
   - Business Edition.
   - Professional Edition for accountants/bookkeepers/BAS agents.
   - Enterprise as a future tier.

3. AI Memory
   - Remember preferences for branding, logos, colors, styles, wording, fields, payment terms, delivery methods, recurring customers, recurring invoices, suppliers, and prior decisions.
   - Product principle: if a user repeats a task, memory gaps must be treated as a product defect to fix.

4. Customer Profiles
   - Create manually or from uploaded documents/photos.
   - Store profile metadata, contacts, addresses, ABN/tax IDs, notes, invoices, quotes, payments, receipts, photos, attached files, timeline events, and preferences.
   - Support recurring customers and fast repeat invoicing.

5. Supplier Profiles
   - Store supplier profiles, purchase history, invoices, warranties, lead times, payment terms, notes, photos, and recurring expenses.

6. Jobs (First-Class Entity)
   - A Job links the full context of work performed: customer, supplier(s), quotes, invoices, purchase orders, delivery dockets, photos, videos, files, expenses, notes, payments, AI memory, and timeline.
   - Everything related to work performed should be linkable to a Job.

7. Universal Search (Core Service)
   - Mandatory cross-platform search for documents, customers, suppliers, photos, logos, receipts, invoices, quotes, purchase orders, delivery dockets, contracts, payments, expenses, notes, AI memories, jobs, attachments, and timeline events.
   - Search architecture is a platform service, not a feature add-on.

8. AI Document Intelligence
   - Accept PDFs, images, Word, Excel, screenshots, receipts, invoices, contracts, purchase orders, delivery dockets, and email attachments.
   - Extract document type, parties, ABN/tax ID, dates, GST, totals, line items, references, payment terms, and key fields.
   - Convert uploaded documents into preferred branded styles.

9. Branding and Logo Studio
   - Upload custom logos and manage branding assets.
   - Assist users without logos by guiding branding direction.
   - Recommend colors, fonts, wording, layouts, sections, and style based on stored preferences.

10. Smart Sending
   - Prompt delivery options after finalization: Email, SMS/messages, WhatsApp, copy link, QR code, print, or PDF download.
   - Support multi-recipient send, CC accountant/bookkeeper, and copy-to-self.

11. Platform Timeline and Immutable Audit History
   - Track events including created, edited, finalized, sent, delivered, opened, viewed, downloaded, reminder sent, payment declared, receipt uploaded, payment detected, approved, and completed.
   - Expand to all meaningful platform actions (for example login, customer/supplier/profile updates, logo changes, integration connections, settings changes, and AI recommendation acceptance).
   - Store events in an immutable activity timeline.

12. Automatic Reminders
   - Configurable reminder cadence (3, 7, 14, 30 days or custom).
   - Stop reminders on approved/detected/manual paid status.
   - Avoid false non-payment assertions when status confidence is uncertain.

13. Payment Centre
   - Support payment methods: bank transfer, Stripe, Square, eWAY, PayPal, cash, cheque, and other.
   - Provide customer "I've Paid" declarations with amount, date, reference, bank, notes, and receipt upload.
   - Notify owners and allow approve/reject actions with full audit log.

14. Live Bank Feeds / Open Banking (Future/Advanced)
   - Future optional connection with user authorization.
   - Detect incoming payments and match invoices using amount, reference, payer name, invoice number, and confidence score.
   - Only auto-mark paid when confidence/rules pass; otherwise require review.

15. Accounting, Tax, and ATO Connectivity
   - Work standalone first, with optional exports/connectors for MYOB, Xero, QuickBooks, Reckon.
   - Support CSV, Excel, PDF exports and ATO-ready reports.
   - Support future official ATO integrations only where legally supported and user-authorized.

16. Accountant / Bookkeeper Portal
   - Invite advisors with permission-based access and no shared passwords.
   - Enable advisor views for invoices, expenses, receipts, bills, GST/BAS summaries, spending, supplier docs, reports, audit logs, and attachments.
   - Support advisor notes, missing-doc requests, issue flags, and reconciliation review.

17. Spending Intelligence
   - Track and categorize expenses across common categories.
   - Show trends by month, supplier, category, and budget vs actual.
   - Provide unusual spending alerts and receipt intelligence from photos.

18. Financial Hub
   - Dashboard for outstanding/overdue invoices, expected income, upcoming bills, expenses, profit trends, GST summaries, cash flow forecast, payment-speed metrics, supplier spend, and AI recommendations.

19. Integrations and Storage
   - Integrations: Google Drive, OneDrive, Dropbox, Microsoft 365, Google Workspace, email import, and future marketplace extensions.
   - Provide secure searchable document vault behavior.

20. User Ownership and Portability
   - Mandatory support for easy export, full backup, migration, import, and no vendor lock-in.

21. Professional Quality Standard
   - Every generated document must be immediately suitable for sending to a customer without external editing.
   - Quality criteria include layout consistency, typography consistency, branding consistency, spacing standards, logo handling, PDF quality, and accessibility baseline.

22. Progressive Complexity UX
   - Keep first-run and common workflows simple.
   - Unlock advanced workflows naturally without restricting power users.

23. Subscription Strategy
   - Tiers: Personal, Business, Professional, Enterprise.
   - Users select a plan by needs.
   - Tax-position statement must avoid universal deductibility claims; users should confirm with their accountant.

## Non-Goals (Current Step)
- Final implementation details.
- UI/UX screens and interactions.
- Backend/service architecture.
