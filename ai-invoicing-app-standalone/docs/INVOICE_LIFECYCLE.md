# Invoice Lifecycle (Invoice-First Slice)

## Purpose
Define the invoice-first lifecycle as the initial implementation path within the broader AI Business OS.

## Baseline States
1. Created
2. Edited
3. Finalized
4. Sent
5. Delivered
6. Opened/Viewed
7. Reminder Sent
8. Payment Declared
9. Receipt Uploaded
10. Payment Detected
11. Approved
12. Completed

## Rules
- All state transitions must write immutable timeline events.
- Reminder schedules must pause/stop when paid is approved/detected/manual confirmed.
- If payment confidence is uncertain, status must remain reviewable and avoid false non-payment assertions.
- Manual confirmation remains available for all automatic detections.

## Slice 1 Scope
- Implement draft-to-finalized-to-PDF lifecycle with timeline scaffolding.
- Keep sending and payment states modeled but only minimally activated if needed for foundational continuity.
