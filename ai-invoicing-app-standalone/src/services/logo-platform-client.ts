/**
 * Client for the shared ALEYA Logo Creator platform (Supabase project aleya-logo-creator).
 * Active Brand Kits are the source of truth across Logo Creator, Invoicing, and ABoss.
 */

export type SharedBrandKit = {
  id: string;
  name: string;
  business_name: string;
  tagline: string | null;
  primary_colors: string[];
  secondary_colors: string[];
  svg_markup: string | null;
  is_active: boolean;
  aleya_business_id: string | null;
  source_app: string;
  layout: string | null;
  icon_concept: string | null;
  editable_metadata?: Record<string, unknown> | null;
};

export type SyncBrandKitInput = {
  businessId: string;
  businessName: string;
  tagline?: string | null;
  industry?: string;
  style?: string;
  primaryColor: string;
  secondaryColor: string;
  iconIdea?: string;
  layout?: string;
  svgMarkup: string;
  concept?: Record<string, unknown>;
  sourceApp?: string;
  returnUrl?: string;
  brandKitId?: string;
};

function platformConfig() {
  const url = process.env.LOGO_CREATOR_SUPABASE_URL || process.env.ALEYA_LOGO_SUPABASE_URL || '';
  const serviceKey =
    process.env.LOGO_CREATOR_SERVICE_ROLE_KEY || process.env.ALEYA_LOGO_SERVICE_ROLE_KEY || '';
  const platformSecret = process.env.ALEYA_PLATFORM_SECRET || '';
  const functionsBase = url ? `${url.replace(/\/$/, '')}/functions/v1/logo-platform` : '';
  return { url, serviceKey, platformSecret, functionsBase, enabled: Boolean(url && (serviceKey || platformSecret)) };
}

export function isLogoPlatformConfigured(): boolean {
  return platformConfig().enabled;
}

export async function fetchActiveBrandKit(businessId: string): Promise<SharedBrandKit | null> {
  const cfg = platformConfig();
  if (!cfg.enabled || !businessId) return null;

  if (cfg.serviceKey) {
    const res = await fetch(
      `${cfg.url}/rest/v1/brand_kits?aleya_business_id=eq.${encodeURIComponent(businessId)}&is_active=eq.true&select=*&limit=1`,
      {
        headers: {
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as SharedBrandKit[];
    return rows[0] ?? null;
  }

  if (cfg.platformSecret && cfg.functionsBase) {
    const res = await fetch(`${cfg.functionsBase}/active-brand-kit?businessId=${encodeURIComponent(businessId)}`, {
      headers: {
        apikey: process.env.LOGO_CREATOR_ANON_KEY || cfg.platformSecret,
        'x-aleya-platform-secret': cfg.platformSecret,
        'x-aleya-business-id': businessId,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { brandKit?: SharedBrandKit | null };
    return body.brandKit ?? null;
  }

  return null;
}

export async function syncActiveBrandKit(input: SyncBrandKitInput): Promise<SharedBrandKit | null> {
  const cfg = platformConfig();
  if (!cfg.enabled) return null;

  // Prefer edge function with platform secret (works across auth boundaries).
  if (cfg.platformSecret && cfg.functionsBase) {
    const res = await fetch(cfg.functionsBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.LOGO_CREATOR_ANON_KEY || cfg.platformSecret,
        Authorization: `Bearer ${cfg.platformSecret}`,
        'x-aleya-platform-secret': cfg.platformSecret,
        'x-aleya-business-id': input.businessId,
        'x-aleya-product': input.sourceApp || 'aleya-invoicing',
      },
      body: JSON.stringify({
        action: 'platform_sync_active_brand_kit',
        ...input,
        aleyaBusinessId: input.businessId,
        svgMarkup: input.svgMarkup,
        sourceApp: input.sourceApp || 'aleya-invoicing',
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Logo platform sync failed (${res.status}): ${text}`);
    }
    const body = (await res.json()) as { brandKit?: SharedBrandKit };
    return body.brandKit ?? null;
  }

  // Direct service-role upsert into shared tables.
  if (cfg.serviceKey) {
    const headers = {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    // Find prior kit for this business to reuse owner/workspace.
    const priorRes = await fetch(
      `${cfg.url}/rest/v1/brand_kits?aleya_business_id=eq.${encodeURIComponent(input.businessId)}&select=owner_id,workspace_id,project_id&limit=1`,
      { headers },
    );
    const prior = priorRes.ok ? ((await priorRes.json()) as Array<{ owner_id: string; workspace_id: string; project_id: string }>) : [];
    if (!prior[0]) {
      // Without an existing owner we cannot insert auth-scoped rows via REST alone.
      return null;
    }
    const ownerId = prior[0].owner_id;
    const workspaceId = prior[0].workspace_id;

    await fetch(`${cfg.url}/rest/v1/brand_kits?workspace_id=eq.${workspaceId}&is_active=eq.true`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });

    const insertRes = await fetch(`${cfg.url}/rest/v1/brand_kits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspace_id: workspaceId,
        owner_id: ownerId,
        project_id: prior[0].project_id,
        concept_id: prior[0].project_id, // placeholder replaced below if needed — use editable concept id when present
        name: `${input.businessName} Brand Kit`,
        business_name: input.businessName,
        tagline: input.tagline ?? null,
        primary_colors: [input.primaryColor],
        secondary_colors: [input.secondaryColor],
        typography: { heading: 'serif', body: 'sans' },
        icon_concept: input.iconIdea ?? null,
        layout: input.layout ?? null,
        generation_history: [],
        editable_metadata: { concept: input.concept ?? null },
        svg_markup: input.svgMarkup,
        is_active: true,
        source_app: input.sourceApp || 'aleya-invoicing',
        aleya_business_id: input.businessId,
      }),
    });
    if (!insertRes.ok) {
      // Concept FK may fail if we reused project_id as concept_id; fall back to null sync.
      return null;
    }
    const rows = (await insertRes.json()) as SharedBrandKit[];
    const kit = rows[0] ?? null;
    if (kit) {
      await fetch(`${cfg.url}/rest/v1/workspaces?id=eq.${workspaceId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ active_brand_kit_id: kit.id }),
      });
    }
    return kit;
  }

  return null;
}

export function brandKitToLogoReference(kit: {
  id?: string;
  business_name: string;
  tagline?: string | null;
  primary_colors?: string[];
  secondary_colors?: string[];
  svg_markup?: string | null;
  layout?: string | null;
  icon_concept?: string | null;
  editable_metadata?: Record<string, unknown> | null;
}): string {
  const concept = (kit.editable_metadata?.concept || {}) as Record<string, unknown>;
  const payload = {
    brandKitId: kit.id || null,
    id: String(concept.id || kit.id || cryptoRandom()),
    businessName: kit.business_name,
    tagline: kit.tagline ?? null,
    industry: String(concept.industry || 'General'),
    style: String(concept.style || 'modern'),
    primaryColor: kit.primary_colors?.[0] || '#173f35',
    secondaryColor: kit.secondary_colors?.[0] || '#c4f36b',
    iconIdea: kit.icon_concept || String(concept.iconIdea || 'mark'),
    layout: kit.layout || String(concept.layout || 'lockup'),
    markShape: String(concept.markShape || 'circle'),
    monogram: String(concept.monogram || kit.business_name.slice(0, 2).toUpperCase()),
    seed: String(concept.seed || 'shared'),
    svg: kit.svg_markup || '',
  };
  return `aleya-logo:v1:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function cryptoRandom(): string {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
