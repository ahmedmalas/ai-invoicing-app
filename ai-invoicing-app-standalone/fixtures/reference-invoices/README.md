# Reference invoices (dev/test only — not served by the production HTTP app)

- `Cart_N_Tip_107.pdf` — user-supplied layout reference (Cursor upload `Cart_N_Tip__107_e19b.pdf`).
- Used only by automated tests and as documentation for the Quantum Hire layout preset.
- **Not** included in the Vercel function `includeFiles` bundle, and there is no public route that serves this file.
- Runtime branding marks for PDF generation live in `src/assets/branding/` (private to the server bundle).
