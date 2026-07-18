# ALEYA Logo Creator

Standalone Vite + React + TypeScript product for generating vector logo concepts and Brand Kits. It talks to the **shared Supabase project** used by Aleya Invoicing and ABoss so active branding can sync across the platform.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Shared Supabase URL (`https://wrmwthsfbpkjsxsqigpw.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Anon / publishable key for the shared project |

Never put the service role key in this frontend app.

## Architecture

```
┌─────────────────────┐     JWT      ┌──────────────────────────────┐
│ ALEYA Logo Creator  │─────────────▶│ Shared Supabase              │
│ (this Vite SPA)     │              │  · Auth                      │
│                     │   tables     │  · workspaces                │
│  logo-engine.ts     │─────────────▶│  · logo_projects             │
│  platform.ts        │              │  · logo_concepts             │
│                     │   edge fn    │  · brand_kits                │
│                     │─────────────▶│  · Edge Function logo-platform│
└─────────────────────┘              └──────────────┬───────────────┘
                                                    │
                    ┌───────────────────────────────┼────────────────┐
                    ▼                               ▼                ▼
           Aleya Invoicing                       ABoss          Future modules
           (active brand ref)              (?source=aboss)
```

- **Generation** runs in the browser via `src/lib/logo-engine.ts` (deterministic SVG concepts, ported from Aleya Invoicing’s logo studio).
- **Persistence** goes through `src/lib/platform.ts`, which calls the shared Edge Function `logo-platform` with the user JWT and falls back to direct Supabase table access when the function is unavailable.
- **Active Brand Kit** is stored on `brand_kits.is_active` and `workspaces.active_brand_kit_id` so ABoss / Invoicing can read the same record.

## Entry points

| URL | Meaning |
| --- | --- |
| `/?source=standalone` | Default product entry |
| `/?source=aboss&returnUrl=…` | Opened from ABoss (see `integrations/aboss/README.md`) |
| `/?source=aleya-invoicing&returnUrl=…` | Opened from Aleya Invoicing |

## Product flows

1. **Generate** — enter business name, tagline, industry, style, colours, icon ideas → create `logo_projects` row → generate N concepts → insert `logo_concepts` (with SVG markup).
2. **Select** — mark a favourite concept (`is_selected` + `logo_projects.selected_concept_id`).
3. **Brand Kit** — create a kit from the selected concept; list / reopen / edit kits; set one as **active**.
4. **Export** — download SVG or client-side PNG (canvas rasterization).

## Deploy

This is a static SPA. `vercel.json` rewrites all routes to `index.html`. Set the same `VITE_*` env vars in the Vercel project.
