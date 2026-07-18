# ABoss ↔ ALEYA Logo Creator

ABoss opens the standalone Logo Creator so organisations can design Brand Kits that sync through the **shared Supabase platform** (same project as Aleya Invoicing).

## Launch URL

Open Logo Creator with:

```
https://<logo-creator-host>/?source=aboss&returnUrl=<https-encoded-return-url>&businessId=<optional-external-id>
```

Query parameters:

| Param | Required | Description |
| --- | --- | --- |
| `source=aboss` | yes | Marks the session as an ABoss entry so UI copy and `source_app` tagging reflect ABoss |
| `returnUrl` | recommended | Where the user can return after setting an active Brand Kit |
| `businessId` | optional | External ABoss business / org id stored on the project / kit as `aleya_business_id` |

Example:

```
https://logo.aleya.app/?source=aboss&returnUrl=https%3A%2F%2Faboss.au%2Fsettings%2Fbranding&businessId=org_123
```

## Auth

Users sign in (or sign up) with the shared Supabase Auth identity. ABoss does not proxy credentials into this SPA; the browser holds the Supabase session JWT used for:

- RLS-scoped reads/writes on `workspaces`, `logo_projects`, `logo_concepts`, `brand_kits`
- Calls to `POST ${SUPABASE_URL}/functions/v1/logo-platform` with `Authorization: Bearer <user JWT>`

## Active Brand Kit sync

When a user **sets a Brand Kit as active** in Logo Creator:

1. `brand_kits.is_active` is set `true` for that kit (others in the workspace cleared).
2. `workspaces.active_brand_kit_id` points at that kit.
3. ABoss (and Aleya Invoicing) read the active kit from the shared tables / `logo-platform` action `get_active_brand_kit`.

Historical documents in ABoss or Invoicing should snapshot branding at issue time; changing the active kit must not rewrite past PDFs.

## Suggested ABoss read path

```ts
// Server-side or authenticated client against the shared project
const { data } = await supabase
  .from('brand_kits')
  .select('*')
  .eq('is_active', true)
  .maybeSingle();

// data.svg_markup, data.primary_colors, data.business_name, …
```

Or call the edge function:

```json
{ "action": "get_active_brand_kit" }
```

## Return UX

Logo Creator shows a **Return to ABoss** control when `returnUrl` is present. After setting an active kit it also prepares `brandKitId` / `active=1` query hints for the return URL (logged client-side); ABoss can append those when navigating back if desired.
