# Document Platform Model (Baseline)

## Platform-First Model
The system should treat all document types as instances of a common platform model, with type-specific rules layered on top and shared AI memory feeding recommendations and automation.

## Core Concepts

1. Document
   - A stored business or personal artifact (uploaded or created in-app).
   - Has a type (document, invoice, final invoice, quote, receipt, bill, statement, timesheet, delivery docket, purchase order, contract, letter, form, custom, and future types).

2. Source + Structured Data
   - Source: original uploaded file or created draft source.
   - Structured data: extracted and normalized fields used for conversion and regeneration.
   - Extraction metadata: confidence, parser/OCR version, review status, and field provenance.

3. Template
   - Defines layout, styling, wording, and field visibility rules.
   - Can be reused across documents with compatible structures.

4. Job (First-Class)
   - Work container linking customer, supplier(s), quotes, invoices, purchase orders, delivery dockets, photos, videos, files, expenses, notes, timeline events, payments, and AI memory.
   - Any work-related artifact should support job linkage.

5. Brand Profile
   - Stores logos, colors, typography direction, and tone preferences.
   - Supports both user-supplied and guided branding setup.
   - Supports per-edition and per-workspace defaults.

6. Preference Profile
   - Stores user-level defaults and preferred output styles.
   - Includes sending preferences, recurring patterns, wording choices, field structure defaults, and prior approvals/rejections.
   - Influences recommendations and conversion behavior over time.

7. Conversion
   - Transforms source + structured data into a preferred branded output format.
   - Should preserve traceability to original source and extraction metadata.

8. Profile Entities
   - Customer profile: contacts, ABN/tax IDs, addresses, notes, docs, photos, timelines, preferences, recurring flags.
   - Supplier profile: documents, purchase history, warranties, lead times, payment terms, recurring expense metadata.
   - Advisor profile: accountant/bookkeeper/BAS-agent access model and collaboration context.

9. Universal Search Service (Core)
   - Shared search indexing and retrieval over documents, customers, suppliers, photos, logos, receipts, invoices, quotes, purchase orders, delivery dockets, contracts, payments, expenses, notes, AI memories, jobs, attachments, and timeline events.
   - Search capability is architecture-critical and not optional.

10. Activity Timeline
   - Immutable event stream for every meaningful action, including login, document/profile/settings/integration actions, recommendation acceptance, and financial lifecycle transitions.
   - Serves as operational history and audit log baseline.

11. Ownership and Portability
   - User-controlled export, backup, migration, and import support with no lock-in assumptions.

## Document Lifecycle (Baseline)
1. Ingest: upload or create.
2. Understand: classify and extract key details.
3. Review: user confirms or edits extracted data.
4. Store: persist source + normalized data + metadata securely.
5. Convert/Recreate: render into preferred branded structure.
6. Send/Track: distribute through selected channel(s) and track events.
7. Export: generate final output artifacts (PDF first in Slice 1).

## Slice 1 Alignment
- Slice 1 implements invoice draft-to-PDF as the first concrete document lifecycle path.
- Slice 1 should include timeline event scaffolding and baseline profile entities.
- The model must remain extensible to other document types without major redesign.
