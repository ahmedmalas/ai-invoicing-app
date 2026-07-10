# Search and Timeline Architecture

## Universal Search Is Mandatory
Universal search is a core platform service and architecture boundary, not a deferred enhancement.

Search scope (target):
- Documents
- Customers
- Suppliers
- Photos
- Logos
- Receipts
- Invoices
- Quotes
- Purchase Orders
- Delivery Dockets
- Contracts
- Payments
- Expenses
- Notes
- AI Memories
- Jobs
- Attachments
- Timeline Events

## Platform Timeline Is Mandatory
Every meaningful action across the platform emits an immutable event.

Example events:
- Login
- Document Created
- Document Edited
- Invoice Sent
- Quote Accepted
- Payment Detected
- Reminder Sent
- Customer Created
- Supplier Updated
- Receipt Uploaded
- Logo Changed
- Integration Connected
- Settings Changed
- AI Recommendation Accepted

## Design Requirements
- Event taxonomy must be versioned and backward compatible.
- Search indexing must support entity filtering, timeline filtering, and linked-context retrieval.
- Timeline and search should reinforce each other: events are searchable and entities expose timeline history.
