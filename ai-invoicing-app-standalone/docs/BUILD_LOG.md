# Build Log

## 2026-07-06

### Foundation Initialization
- Created standalone project folder: `ai-invoicing-app-standalone`
- Added root project overview: `README.md`
- Added vision document: `docs/VISION.md`
- Added features baseline: `docs/FEATURES.md`
- Added technical decision baseline: `docs/TECH_DECISIONS.md`
- Added this build log: `docs/BUILD_LOG.md`

### Notes
- Recovery-based patching was intentionally not used.
- Project is being rebuilt from source-of-truth requirements.
- No application implementation started in this step.

### Product Vision Pivot (Document Platform First)
- Updated `README.md` from invoice-only framing to document-platform-first framing.
- Updated `docs/VISION.md` to support personal + business document workflows.
- Updated `docs/FEATURES.md` with multi-document creation, conversion, secure storage, branding, recommendations, and preference memory.
- Updated `docs/TECH_DECISIONS.md` with confirmed product pivot decisions and additional open decisions for document-platform architecture.
- Added `docs/PRODUCT_PIVOT.md` to capture pivot rationale and product consequences.
- Added `docs/DOCUMENT_PLATFORM_MODEL.md` to define baseline platform model and document lifecycle.

### Notes
- Slice 1 remains implementation-planning only at this stage.
- No application code implementation started in this step.

### Product Vision Pivot (AI Business OS)
- Updated `README.md` to position the product as an AI Business OS with editions and document-platform scope.
- Updated `docs/VISION.md` with expanded mission, target users, and document + operations outcomes.
- Expanded `docs/FEATURES.md` into 18 platform capabilities including AI memory, customer/supplier profiles, smart sending, payment centre, timeline, reminders, accountant portal, spending intelligence, financial hub, integrations, and subscription strategy.
- Updated `docs/TECH_DECISIONS.md` with AI Business OS baselines, edition strategy, integration strategy, and compliance/truthfulness guardrails.
- Updated `docs/PRODUCT_PIVOT.md` from document-platform pivot to AI Business OS pivot framing.
- Updated `docs/DOCUMENT_PLATFORM_MODEL.md` with generalized entities, intelligence pipeline, and profile-centered memory model.
- Added `docs/AI_BUSINESS_OS.md` as the canonical product blueprint.
- Added `docs/INVOICE_LIFECYCLE.md` for invoice-first timeline and state model.
- Added `docs/PAYMENT_AND_BANK_FEEDS.md` for payment centre behavior and future bank-feed matching.
- Added `docs/ACCOUNTANT_PORTAL.md` for advisor access model.
- Added `docs/INTEGRATIONS.md` for standalone-first integration policy.
- Added `docs/SUBSCRIPTIONS.md` for plan structure and tax-language guardrails.

### Notes
- This update is documentation-only.
- No application code implementation started in this step.

### Slice Implementation Milestones (Executed)

#### Slice 1 — Invoice Vertical Foundation
- Implemented backend-first vertical for customer/profile/preferences, invoice draft/finalise, GST totals, PDF generation, timeline, and search scaffolding.
- Added unit, integration, and e2e coverage with build/type/lint/test gates.

#### Slice 2 — DB-Level Finalised Invoice Immutability
- Added SQLite trigger/constraint hardening so finalised invoice core data is immutable at persistence level.
- Preserved allowed payment/reminder updates and added deterministic conflict handling.

#### Slice 3 — Timeline Event Taxonomy + Versioning
- Replaced ad-hoc timeline strings with canonical typed/versioned taxonomy keys.
- Added migration-safe legacy compatibility and taxonomy enforcement trigger coverage.

#### Slice 4 — Jobs Entity Foundation
- Added first-class `jobs` domain, persistence, API routes, timeline events, and search integration.
- Added tests for CRUD, customer linkage, timeline, and e2e flow.

#### Slice 5 — Job Documents + Invoice Linkage
- Extended `job_document_links` scaffolding into working linkage/listing support for job-document and job-invoice links.
- Added timeline linkage events and deterministic duplicate-link conflicts.

#### Slice 6 — Jobs Workflow Foundation
- Commit: `3ca48a2ad4d29f3e1a733a808b91758136496cfc`
- Added scheduling windows, assignment fields, validated status transition workflow, and timeline events for scheduling/assignment/status changes.
- Added unit, integration, and e2e tests for workflow behavior and validation.

#### Slice 7 — Users/Roles Foundation + Job Assignment Integrity
- Commit: `53277c89e10c31fd922a63449c964d756353996b`
- Added minimal users/roles persistence with user-role association links.
- Added create/list/get APIs for users and roles using existing backend route patterns.
- Enforced assignment integrity for jobs so assigned users must exist, be active, and have assignable roles; canonicalized assignment display names from user records.
- Added deterministic error handling for orphan assignment IDs and assignment policy violations.
- Added unit, integration, and e2e coverage for users/roles foundations and assignment integrity.

#### Slice 8 — Teams Membership Foundation + Assignment Scope Controls
- Commit: `44b44185c7fa5f82f7097e23c1008de90f7f3d60`
- Added minimal teams persistence with create/list/get support.
- Added team membership persistence with deterministic duplicate handling.
- Extended jobs with optional `teamId` and team-scoped assignment validation.
- Enforced deterministic `ASSIGNED_USER_OUTSIDE_TEAM_SCOPE` validation when team-scoped assignments are invalid.
- Preserved Slice 6/7 behavior for jobs when `teamId` is absent.
- Added unit, integration, and e2e tests for team validation, memberships, and assignment scope controls.

#### Slice 9 — Team Membership Lifecycle Integrity
- Commit: `5549776666f2f663c67ff3a834a4e753d7e61537`
- Added `DELETE /teams/:teamId/members/:userId` for team member removal.
- Blocked team member removal when user has assigned jobs scoped to the same team using deterministic `TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS`.
- Added `team.member_removed` timeline taxonomy event and persistence emission on successful removals.
- Added tests for blocked/successful removal lifecycle and regression coverage for existing team assignment behavior.

#### Slice 10 — Team Deletion Integrity
- Commit: `34abe09699cdf570e92001cc0aa446a6e1dbf46f`
- Added `DELETE /teams/:teamId` to complete team lifecycle with deterministic deletion behavior.
- Blocked team deletion while memberships exist using `TEAM_HAS_MEMBERS`.
- Blocked team deletion while team-scoped jobs still exist using `TEAM_HAS_JOBS`.
- Added `team.deleted` timeline taxonomy event and persistence emission on successful deletion.
- Added unit, integration, and e2e coverage for delete success, conflict guards, not-found behavior, and timeline verification.

#### Slice 11 — Team Assignment Audit + Reconciliation
- Commit: `8a5420c5b022ab3b1f1cc478cfb34ebbcfe8e78f`
- Audited team deletion and team/job assignment integrity with no defects found.
- Confirmed deterministic behavior for empty/member/job deletion paths, assignment/unassignment integrity, and `team.deleted` emission conditions.
- Confirmed no duplicate team deletion logic and documentation/runtime alignment.

#### Slice 12 — Team Permissions Foundation
- Commit: `8fad55205d23a096ca1a6bf3c6736d02798df8b9`
- Added backend-only team membership role scaffolding (`owner`, `manager`, `member`) with server-side validation.
- Extended team membership persistence and listing to include role while preserving existing member flows and team deletion guards.
- Added startup-safe schema evolution for existing databases by backfilling membership role defaults.
- Added deterministic tests for valid/invalid role handling and role persistence across API/integration paths.

#### Slice 13 — Team Role Authorization Foundation
- Commit: `651ae8c84ec697de665f997a4f636a9d6cb9f16b`
- Added server-side role authorization helper for team management actions (`owner`, `manager`, `member`).
- Added `PATCH /teams/:teamId/members/:userId/role` for deterministic membership role updates.
- Enforced deterministic authorization and owner-protection errors (`TEAM_PERMISSION_DENIED`, `TEAM_OWNER_MODIFICATION_FORBIDDEN`, `TEAM_LAST_OWNER_REQUIRED`).
- Enforced final-owner safeguards for member removal and owner demotion.
- Preserved team/job assignment integrity and team deletion safeguards against linked jobs (`TEAM_HAS_JOBS`) while requiring owner authorization for team deletion when memberships exist.
- Added unit, integration, and e2e coverage for authorization paths, role updates, and regressions.

#### Slice 15 — Final Invoice Audit Trail + Query Readiness
- Commit: `ca2e8491ad5ef32284af6eb0ec774b9de48e944b`
- Executed as strict test/docs scope with no new final invoice entity, no new timeline taxonomy keys, and no new API endpoints.
- Confirmed existing `invoice.finalised` lifecycle event is the canonical audit event for final invoice state readiness.
- Added focused end-to-end proof coverage that finalised invoices remain immutable for update routes, `invoice.finalised` is queryable via existing timeline endpoint, and missing/invalid timeline lookups are deterministic under current endpoint behavior.
- Preserved current architecture decisions: no read/list timeline events and no organizationId scoping changes.

#### Slice 17 — Statement Audit & Export Hardening
- Commit: `dbd1d71b967c6fd4da84fae60298116025de5817`
- Added read-only customer statement endpoints for JSON, printable HTML, and PDF export using existing invoice/finalisation data only.
- Reused the existing PDF infrastructure (`src/services/pdf-service.ts` with PDFKit) and kept a single PDF pipeline.
- Enforced deterministic statement validation for invalid customer IDs, missing customers, invalid date formats, and invalid date ranges.
- Confirmed statement selection rules: finalised invoices included, draft invoices excluded, period and customer filters enforced, opening/closing balances derived at read time only.
- Added hardening proof that HTML and PDF exports use the same statement source data via shared source-signature headers.
- Intentionally omitted statement timeline event emission to align with current architecture (read/report queries do not emit timeline events).
- Added regression test proof that statement generation performs no statement/audit writes to persistence.

#### Slice 18 — Invoice Credit Notes (Lifecycle-Safe)
- Commit: `e8eb9f9e8b5b4dcf6a38cc9d7bee1e83a35cae97`
- Added first-class credit note persistence linked to existing invoices without changing invoice states, finalisation flow, or invoice totals.
- Added lifecycle-safe validation for non-existent invoice, draft invoice, cancelled invoice, over-credit attempts, and duplicate full-credit attempts.
- Added read model endpoints for credit note retrieval by id, customer, invoice, and filtered listing.
- Added HTML and PDF credit note rendering through the existing PDF service pipeline (`src/services/pdf-service.ts`) and route conventions.
- Added `credit_note.created` taxonomy event and timeline emission aligned with existing timeline architecture.
- Added unit and end-to-end test coverage for full/partial credit creation, validation rejection paths, immutable invoice proof, retrieval/filtering, HTML/PDF rendering, and timeline behavior.

#### Slice 19 — Customer Payments (Allocation Without Ledger)
- Commit: `daa92f7b1cf2613287c94801873e4a0fac0bdcc6`
- Added first-class customer payment persistence with allocation records linked to finalised invoices.
- Added lifecycle-safe allocation validation for invoice existence/finalised state/customer match, duplicate allocations, positive amounts, payment amount caps, and per-invoice outstanding caps.
- Added read model endpoints for payment retrieval by id, customer, invoice, and date range filters.
- Added HTML and PDF payment receipt rendering through the existing PDF service pipeline (`src/services/pdf-service.ts`) and route conventions.
- Added `payment.created` and `payment.allocated` taxonomy events and timeline emission via existing timeline infrastructure.
- Added focused unit and end-to-end coverage for full/partial/multi-invoice allocations, rejection paths, retrieval/filtering, receipt rendering, timeline events, and invoice total immutability proof.

#### Slice 20 — Supplier Bills (Accounts Payable Foundation)
- Commit: `ae95148266983e4bbf2a6863b0c0ed686e06bf7b`
- Added first-class supplier persistence and supplier bill draft/finalised lifecycle using existing document conventions.
- Added lifecycle-safe validation for invalid supplier, empty bill, negative quantity/price, duplicate supplier references, and invalid date-range filters.
- Added deterministic read model filters for supplier, bill number, status, bill date ranges, and due date ranges.
- Added supplier bill HTML and PDF rendering through the existing PDF service pipeline (`src/services/pdf-service.ts`) with no secondary PDF implementation.
- Added `supplier_bill.created` and `supplier_bill.finalised` timeline taxonomy events and emissions through the existing audit architecture.
- Added immutable behavior protections for finalised supplier bills and line items at both application and persistence levels.
- Added focused unit and end-to-end coverage proving lifecycle, validation rejection paths, timeline emissions, search participation, and finalised immutability.

#### Slice 21 — Supplier Bill Payments (Accounts Payable Payments)
- Commit: `72d476319a0339c38bf9bd3e07fef639a41a7ad9`
- Added first-class supplier payment persistence with allocation records linked to finalised supplier bills.
- Added lifecycle-safe allocation validation for bill existence/finalised state/supplier match, duplicate allocations, positive amounts, payment amount caps, and per-bill outstanding caps.
- Added deterministic read model filters for supplier, supplier bill, and payment date ranges.
- Added supplier payment receipt HTML and PDF rendering through the existing PDF service pipeline (`src/services/pdf-service.ts`) and route conventions.
- Added `supplier_payment.created` and `supplier_payment.allocated` timeline taxonomy events and emissions via existing audit architecture.
- Added focused unit and end-to-end coverage for full/partial/multi-bill allocations, rejection paths, retrieval/filtering, rendering, timeline events, search participation, and bill-total immutability proof.

#### Slice 22 — Purchase Orders (Procurement Foundation)
- Commit: `7db0030f059d3739fdf42634fad6ce8943dba7e4`
- Added first-class purchase order persistence with line items, sequence-based PO numbering, and deterministic read-model filters.
- Added purchase order lifecycle support (`Draft`, `Approved`, `Closed`, `Cancelled`) with explicit transition validation and terminal-state protections.
- Added immutable non-draft safeguards for purchase orders, line items, and linked document records at both application and persistence levels.
- Added purchase order HTML and PDF rendering through the existing PDF service pipeline (`src/services/pdf-service.ts`) and route conventions.
- Added `purchase_order.created`, `purchase_order.approved`, `purchase_order.closed`, and `purchase_order.cancelled` taxonomy events and timeline emissions through existing audit infrastructure.
- Added focused unit and end-to-end coverage for lifecycle transitions, immutability enforcement, validation rejection paths, retrieval/filtering, timeline emissions, and search participation.

#### Slice 23 — Supplier Bill Creation from Purchase Orders
- Commit: `49fafcc8371f5194ec2aa1cbf0b67f9f097f6f14`
- Added deterministic conversion endpoint `POST /purchase-orders/:purchaseOrderId/create-supplier-bill` to create draft supplier bills directly from approved purchase orders.
- Added strict conversion guards for approved-only purchase orders and single-bill-per-purchase-order behavior via deterministic errors (`PURCHASE_ORDER_REQUIRES_APPROVED_STATUS`, `PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED`).
- Added source linkage from supplier bills back to purchase orders (`source_purchase_order_id`) with migration-safe schema evolution and uniqueness enforcement.
- Extended supplier bill read filters to support `sourcePurchaseOrderId`, preserving existing filtering patterns and search/document architecture.
- Added focused end-to-end coverage proving conversion success, duplicate-conversion blocking, draft-order rejection, and linkage/query correctness without introducing inventory, goods receipts, stock movements, or ledgers.

#### Slice 24 — Purchase Order Billing Status & Partial Conversion
- Commit: `846ce07dd10b717f8f9f7d9c2d3f5fdb0b2611e4`
- Extended PO-to-supplier-bill conversion to support partial line-item and partial-quantity billing across multiple supplier bills.
- Added calculated (non-persisted) purchase-order billing status and amounts: `unbilled`, `partially_billed`, `fully_billed`, plus total billed and remaining unbilled.
- Enforced deterministic over-billing guardrails for line quantities and remaining PO amount, with approved-only billing behavior preserved.
- Added PO/Supplier-Bill linkage rendering in HTML/PDF outputs while reusing existing PDF infrastructure.
- Added timeline emissions for billing progression and PO-origin supplier bill creation (`purchase_order.partially_billed`, `purchase_order.fully_billed`, `supplier_bill.created_from_purchase_order`).
- Added focused validation and e2e coverage for partial conversion progression, over-billing rejection, linkage retrieval, and calculated-status behavior without inventory, goods receipts, stock movement, or ledger additions.

#### Slice 25 — Purchase Order Closure Guardrails
- Commit: `c93f17b848247ea10c6cb9f8018d8bdbd62720bf`
- Hardened purchase order closure validation so fully billed orders can close without reason, while unbilled/partially billed closures require explicit `closeReason` and `closedDate`.
- Added deterministic closure rejection paths for invalid status conditions (`PURCHASE_ORDER_DRAFT_CANNOT_CLOSE`, `PURCHASE_ORDER_CANCELLED_CANNOT_CLOSE`, `PURCHASE_ORDER_ALREADY_CLOSED`) and missing closure metadata.
- Extended purchase order read model with closure metadata (`closeReason`, `closedDate`, `closedBy`) while keeping billed totals/status calculated from linked supplier bills and not persisted.
- Enriched `purchase_order.closed` timeline payload metadata with closure type (`fully_billed_closure`, `partially_billed_closure`, `unbilled_closure`) and billed/unbilled summary at close time.
- Updated purchase order HTML/PDF rendering to display closure reason/date and billing context via the existing PDF service pipeline.
- Added focused unit/e2e coverage proving closure guardrails, closure-type timeline metadata, and calculated billing status behavior without introducing inventory, goods-receipt, stock-movement, or ledger features.

#### Slice 26 — Supplier Bill Linking Guardrails from Purchase Orders
- Commit: `10304db7dfb12cd20a0de75cbec52f86f511de66`
- Hardened PO-linked supplier bill draft edits to preserve source PO relationship safety and deterministic over-billing protection during amendment-like updates.
- Exposed `sourcePurchaseOrderLineItemId` in supplier bill line-item read model to keep PO lineage traceable after linked draft edits.
- Added deterministic rejection paths for linked bill edit violations (`SUPPLIER_BILL_LINKED_LINE_SOURCE_REQUIRED`, `SUPPLIER_BILL_SOURCE_PO_LINE_MISMATCH`, existing over-billing guards), while keeping finalised supplier bill immutability unchanged.
- Confirmed PO billing status/amounts continue to be calculated from linked supplier bill line totals and are not persisted as billed balance state.
- Preserved existing timeline architecture and intentionally omitted new supplier-bill-edit timeline events.

#### Slice 27 — Supplier Bill Amendments (Draft-Only Revision Safety)
- Commit: `39144ab6e3462cc0aef6731fac3916be8c3f5874`
- Added draft-only amendment safety for PO-linked supplier bills by enforcing immutable source PO line-reference sets across edits (`SUPPLIER_BILL_SOURCE_PO_LINE_REFERENCE_IMMUTABLE`).
- Added linked-bill currency immutability against source purchase order currency (`SUPPLIER_BILL_LINKED_CURRENCY_IMMUTABLE`) while keeping permitted draft amendments for quantity/description/price/notes/due date/reference.
- Preserved finalised supplier bill immutability and existing supplier bill lifecycle states.
- Added focused e2e coverage proving permitted draft amendments, immutable linkage protections (supplier/PO linkage and PO line references), deterministic over-quantity/over-value rejection, and PO billing recalculation correctness across multi-bill linked edits.
- Confirmed supplier bill and purchase order HTML/PDF routes continue using existing rendering and PDF pipeline behavior with amended draft values reflected from current data.
- Preserved existing timeline architecture and intentionally omitted new draft-amendment timeline events.

#### Slice 28 — Supplier Bill Finalisation Readiness
- Commit: `ecfa194d62a0fd3c08d1f45a869c6f9cb4e3e122`
- Added deterministic draft supplier bill finalisation readiness checks before status transition, including supplier existence, non-empty line items, positive quantity/non-negative price checks, and totals reconciliation against the existing calculation model.
- Added linked purchase order readiness checks at finalisation time for source PO existence, supplier consistency, source PO line reference validity, and remaining quantity/value over-billing protection.
- Preserved supplier bill lifecycle semantics (`Draft` -> `Finalised` only) and existing immutability behavior for finalised bills.
- Preserved purchase order lifecycle semantics and continued deriving PO billing status/amounts from linked supplier bills without persisting calculated balances.
- Extended `supplier_bill.finalised` timeline metadata to distinguish `standalone` vs `purchase_order_linked` finalisations without introducing new taxonomy keys.
- Added focused integration/e2e coverage for readiness failures (empty lines, totals mismatch, supplier mismatch, orphaned PO linkage, invalid PO line refs, over-billing), standalone and linked finalisation metadata, and unchanged HTML/PDF pipeline behavior.

#### Slice 29 — Supplier Bill Finalisation Timeline & Regression Hardening
- Commit: `a8f08203fa50f98f3166644ce8ef7fe99b5e70fc`
- Executed as tests/docs-focused hardening; no production behavior changes were required.
- Added regression assertions that failed finalisation readiness attempts do not emit `supplier_bill.finalised` timeline events.
- Added regression assertions that finalise-again rejections do not create duplicate `supplier_bill.finalised` events for standalone and PO-linked bills.
- Strengthened timeline payload verification for standalone and PO-linked finalisation metadata without adding taxonomy keys.
- Reconfirmed finalised supplier bill immutability, PO billing calculated behavior, and unchanged HTML/PDF rendering pipeline through existing tests.

#### Slice 30 — Supplier Bill Payment Readiness & Linkage Guardrails
- Commit: `de602f2d98a7f0c9c0f9b3de605eec95f4bb4c18`
- Hardened supplier payment allocation readiness checks so allocations only proceed against valid finalised supplier bills with deterministic validation failures.
- Added PO-linked supplier bill revalidation at allocation time (source PO existence, supplier consistency, source-line reference validity, remaining quantity/value constraints) without introducing any new lifecycle states.
- Preserved Supplier Bill totals and Purchase Order billing semantics during payment allocations; PO billing remains calculated from linked supplier bills and is not affected by payments.
- Added/updated tests proving draft/non-existent/wrong-supplier/duplicate/over-allocation rejection, no payment artifacts on failed allocation paths, and PO billing invariance after linked-bill payment allocation.
- Confirmed supplier payment receipt HTML/PDF rendering continues through the existing PDF pipeline.
- Preserved timeline taxonomy keys and existing `supplier_payment.created` / `supplier_payment.allocated` behavior; failed allocations emit no new payment timeline records.

#### Slice 31 — Document Number Sequence Integrity
- Commit: `6494103598038d81a2ef0f9ae7f9f96419f74093`
- Hardened document numbering infrastructure with a shared transactional allocator for invoices, credit notes, customer payments, purchase orders, supplier bills, and supplier payments.
- Added deterministic sequence-failure handling (`DOCUMENT_NUMBER_SEQUENCE_INVALID_STATE`, `DOCUMENT_NUMBER_SEQUENCE_CONFLICT`) to prevent silent duplicate-number behavior under invalid/concurrent sequence conditions.
- Added persistence-level immutability guards preventing direct number mutation for purchase orders, credit notes, customer payments, and supplier payments while preserving existing invoice/supplier bill finalised immutability protections.
- Added integration coverage proving concurrent sequence creation remains unique/deterministic per document type, numbers stay immutable across all six document classes, duplicate numbering does not occur, and HTML/PDF outputs continue to surface assigned numbers through the existing PDF pipeline.

#### Slice 32 — Global Timeline Integrity & Ordering
- Commit: `6fc1a3487d091267862ca2f2539f56f727cc657a`
- Hardened timeline read ordering to deterministic audit ordering with timestamp-first and insertion-stable tie-break semantics, preserving existing timeline API behavior.
- Added deterministic timeline query controls on the existing endpoint (`eventKey`, `limit`, `offset`) with stable pagination and filtering semantics.
- Added deterministic duplicate-transition guardrails for purchase order approval (`PURCHASE_ORDER_ALREADY_APPROVED`) to prevent duplicate lifecycle events.
- Normalized credit note lifecycle metadata to include `creditNoteNumber` in `credit_note.created` payload for cross-document metadata consistency.
- Added integration coverage proving ordering determinism, pagination/filter stability, failed-operation no-event behavior, duplicate-operation no-duplicate-event behavior, and stable concurrent event counts.
- Preserved existing timeline taxonomy keys (no new taxonomy events introduced), lifecycle models, and rendering pipelines.

#### Slice 33 — Global Search Integrity & Cross-Document References
- Commit: `c732ddfcc688510f4ddce885829e8910f70971ef`
- Hardened global search to consistently include customers, suppliers, invoices, credit notes, customer payments, purchase orders, supplier bills, supplier payments, documents, and jobs through the existing search infrastructure.
- Added deterministic ordering and stable pagination controls to search queries (`limit`, `offset`) and deterministic filtering controls (`entityTypes`) without introducing a second search engine.
- Added cross-document reference exposure in search results (`invoice.creditNoteIds`, `invoice.customerPaymentIds`, `purchaseOrder.supplierBillIds`) while preserving existing linked fields on credit notes, payments, supplier bills, and supplier payments.
- Added deterministic number-search support across document-number-bearing entities and preserved immutable-number discoverability after rejected updates.
- Added end-to-end coverage proving deterministic ordering, deterministic pagination/filter behavior, no duplicate search results, case-insensitive/partial matching, cross-document navigation integrity, and concurrent creation search consistency.
- Preserved existing timeline taxonomy and document lifecycle models; no taxonomy changes were introduced.

#### Slice 34 — Global Reporting Read Model Integrity
- Commit: `6ae9f56d029218ea2b65cd3232eac955ca39f4d5`
- Added a shared reporting read-model endpoint (`GET /reports/read-model`) that derives AR/AP metrics from existing document read models only.
- Added deterministic report query controls (`from`, `to`, `limit`, `offset`) with stable ordering and pagination over report rows.
- Added deterministic AR derived reconciliation (`totalInvoiced`, `totalCredited`, `totalPaid`, `outstanding`) and invoice-level derived breakdowns.
- Added deterministic AP derived reconciliation (`totalOrdered`, `totalBilled`, `totalPaid`, `remainingOrderedValue`, `supplierBillOutstanding`) with PO and supplier-bill row breakdowns.
- Added derived customer-statement summary rows (`openingBalance`, `activity`, `closingBalance`) computed from existing invoices, credit notes, and customer payments without persistence.
- Added deterministic snapshot timestamp derivation from source document update timestamps so repeated reads over unchanged data are identical.
- Added integration coverage proving AR/AP reconciliation, deterministic pagination/order, immutable document reportability, no report-side mutations, and concurrent deterministic reporting reads.
- Preserved existing lifecycle models, timeline taxonomy, and rendering pipeline behavior; no taxonomy keys or materialized reporting tables were introduced.

### Current Project Status Snapshot
- Branch: `cursor/slice-34-global-reporting-read-model-integrity-19d3`
- Status at logging: implementation baseline completed through Slice 34 and passing validation gates.

### Pre-Slice 1 Architecture Freeze
- Added `docs/PRODUCT_PRINCIPLES.md` as constitution-level principles for AI Business OS.
- Updated vision and architecture docs to make universal search a mandatory platform capability.
- Introduced Jobs as a first-class platform entity and linked model.
- Expanded immutable timeline requirements to all meaningful platform actions.
- Added explicit user ownership and portability requirements (export, backup, migration, import, no lock-in).
- Added professional quality acceptance criteria for generated documents.
- Added progressive complexity UX philosophy as a required product behavior.
- Added dedicated architecture docs: `SEARCH_AND_TIMELINE_ARCHITECTURE.md`, `JOBS_MODEL.md`, `DATA_OWNERSHIP.md`, `QUALITY_STANDARD.md`, and `UX_PHILOSOPHY.md`.

### Notes
- This update is documentation-only.
- No application code implementation started in this step.
