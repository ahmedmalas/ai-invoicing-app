// Shared Edge Function for ALEYA Logo Creator / Invoicing / ABoss.
// Deployed to project wrmwthsfbpkjsxsqigpw as `logo-platform`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aleya-platform-secret, x-aleya-business-id, x-aleya-product',
};

type Body = {
  action?: string;
  name?: string;
  workspaceId?: string;
  projectId?: string;
  conceptId?: string;
  brandKitId?: string;
  brief?: {
    businessName?: string;
    tagline?: string;
    industry?: string;
    style?: string;
    primaryColor?: string;
    secondaryColor?: string;
    iconIdeas?: string;
    aleyaBusinessId?: string | null;
    aleyaReturnUrl?: string | null;
  };
  concepts?: Array<Record<string, unknown>>;
  regenerate?: boolean;
  patch?: Record<string, unknown>;
  sourceApp?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Body & Record<string, unknown>;
    const action = body.action;
    if (!action) return json({ error: 'Missing action' }, 400);

    // Service-to-service sync from Aleya Invoicing / ABoss (platform secret).
    const platformSecret = Deno.env.get('ALEYA_PLATFORM_SECRET') || '';
    const providedSecret = req.headers.get('x-aleya-platform-secret') || '';
    if (action === 'platform_sync_active_brand_kit' || action === 'health') {
      if (action === 'health') return json({ ok: true, service: 'aleya-logo-platform' });
      if (!platformSecret || providedSecret !== platformSecret) {
        return json({ error: 'Unauthorized platform sync' }, 401);
      }
      const admin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const businessId = String(body.aleyaBusinessId || body.businessId || req.headers.get('x-aleya-business-id') || '');
      const businessName = String(body.businessName || 'Brand');
      const svg = String(body.svgMarkup || body.svg || '');
      const primary = [String(body.primaryColor || '#173f35')];
      const secondary = [String(body.secondaryColor || '#c4f36b')];
      const sourceApp = String(body.sourceApp || 'aleya-invoicing');

      // Reuse prior owner/workspace for this business when available.
      const { data: prior } = await admin
        .from('brand_kits')
        .select('owner_id, workspace_id, project_id, concept_id')
        .eq('aleya_business_id', businessId)
        .limit(1)
        .maybeSingle();
      if (!prior?.owner_id) {
        return json({
          deliveredLocally: true,
          brandKit: {
            id: crypto.randomUUID(),
            name: `${businessName} Brand Kit`,
            business_name: businessName,
            tagline: body.tagline || null,
            primary_colors: primary,
            secondary_colors: secondary,
            svg_markup: svg,
            is_active: true,
            aleya_business_id: businessId,
            source_app: sourceApp,
          },
        });
      }

      await admin.from('brand_kits').update({ is_active: false }).eq('workspace_id', prior.workspace_id).eq('is_active', true);
      const { data: kit, error } = await admin
        .from('brand_kits')
        .insert({
          workspace_id: prior.workspace_id,
          owner_id: prior.owner_id,
          project_id: prior.project_id,
          concept_id: prior.concept_id,
          name: `${businessName} Brand Kit`,
          business_name: businessName,
          tagline: body.tagline || null,
          primary_colors: primary,
          secondary_colors: secondary,
          typography: { heading: 'serif', body: 'sans' },
          icon_concept: body.iconIdea || null,
          layout: body.layout || null,
          generation_history: [],
          editable_metadata: { concept: body.concept || null },
          svg_markup: svg,
          is_active: true,
          source_app: sourceApp,
          aleya_business_id: businessId || null,
        })
        .select('*')
        .single();
      if (error) throw error;
      await admin.from('workspaces').update({ active_brand_kit_id: kit.id }).eq('id', prior.workspace_id);
      return json({ brandKit: kit, message: 'Active Brand Kit synced' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    switch (action) {
      case 'ensure_workspace': {
        const workspace = await ensureWorkspace(supabase, user.id, body.name || 'My Brand Workspace');
        return json({ workspace });
      }
      case 'create_project': {
        const workspaceId =
          body.workspaceId ||
          (await ensureWorkspace(supabase, user.id, body.brief?.businessName || 'My Brand Workspace'))
            .id;
        const brief = body.brief || {};
        const { data, error } = await supabase
          .from('logo_projects')
          .insert({
            workspace_id: workspaceId,
            owner_id: user.id,
            business_name: String(brief.businessName || '').trim(),
            tagline: brief.tagline?.trim() || null,
            industry: String(brief.industry || '').trim(),
            personality: 'trustworthy',
            style: brief.style || 'modern',
            preferred_colors: [brief.primaryColor || '#0f2d26', brief.secondaryColor || '#c4f36b'],
            avoid_colors: [],
            icon_ideas: brief.iconIdeas?.trim() || null,
            typography_direction: 'modern-serif',
            layout_direction: 'lockup',
            status: 'draft',
            aleya_business_id: brief.aleyaBusinessId ?? null,
            aleya_return_url: brief.aleyaReturnUrl ?? null,
          })
          .select('*')
          .single();
        if (error) throw error;
        return json({ project: data });
      }
      case 'list_projects': {
        const { data, error } = await supabase
          .from('logo_projects')
          .select('*')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return json({ projects: data ?? [] });
      }
      case 'get_project': {
        if (!body.projectId) return json({ error: 'projectId required' }, 400);
        const { data: project, error } = await supabase
          .from('logo_projects')
          .select('*')
          .eq('id', body.projectId)
          .single();
        if (error) throw error;
        const { data: concepts, error: cErr } = await supabase
          .from('logo_concepts')
          .select('*')
          .eq('project_id', body.projectId)
          .order('created_at', { ascending: false });
        if (cErr) throw cErr;
        return json({ project, concepts: concepts ?? [] });
      }
      case 'generate_concepts': {
        if (!body.projectId) return json({ error: 'projectId required' }, 400);
        const rows = (body.concepts || []).map((concept) => ({
          project_id: body.projectId,
          owner_id: user.id,
          title: concept.title,
          prompt: concept.prompt,
          icon_concept: concept.icon_concept,
          layout: concept.layout,
          palette: concept.palette ?? {},
          typography: concept.typography ?? {},
          provider: concept.provider ?? 'aleya-logo-engine',
          provider_metadata: concept.provider_metadata ?? {},
          svg_markup: concept.svg_markup,
          is_selected: false,
        }));
        await supabase
          .from('logo_projects')
          .update({ status: 'generating', updated_at: new Date().toISOString() })
          .eq('id', body.projectId);
        const { data, error } = await supabase.from('logo_concepts').insert(rows).select('*');
        if (error) throw error;
        await supabase
          .from('logo_projects')
          .update({ status: 'ready', updated_at: new Date().toISOString() })
          .eq('id', body.projectId);
        return json({ concepts: data ?? [] });
      }
      case 'select_concept': {
        if (!body.projectId || !body.conceptId) {
          return json({ error: 'projectId and conceptId required' }, 400);
        }
        await supabase
          .from('logo_concepts')
          .update({ is_selected: false })
          .eq('project_id', body.projectId);
        const { data, error } = await supabase
          .from('logo_concepts')
          .update({ is_selected: true })
          .eq('id', body.conceptId)
          .eq('project_id', body.projectId)
          .select('*')
          .single();
        if (error) throw error;
        await supabase
          .from('logo_projects')
          .update({
            selected_concept_id: body.conceptId,
            status: 'selected',
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.projectId);
        return json({ concept: data });
      }
      case 'create_brand_kit': {
        if (!body.projectId || !body.conceptId) {
          return json({ error: 'projectId and conceptId required' }, 400);
        }
        const { data: project, error: pErr } = await supabase
          .from('logo_projects')
          .select('*')
          .eq('id', body.projectId)
          .single();
        if (pErr) throw pErr;
        const { data: concept, error: cErr } = await supabase
          .from('logo_concepts')
          .select('*')
          .eq('id', body.conceptId)
          .single();
        if (cErr) throw cErr;
        const palette = (concept.palette ?? {}) as Record<string, string>;
        const { data, error } = await supabase
          .from('brand_kits')
          .insert({
            workspace_id: project.workspace_id,
            owner_id: user.id,
            project_id: project.id,
            concept_id: concept.id,
            name: body.name?.trim() || `${project.business_name} Brand Kit`,
            business_name: project.business_name,
            tagline: project.tagline,
            primary_colors: [palette.primary || project.preferred_colors?.[0] || '#0f2d26'],
            secondary_colors: [palette.secondary || project.preferred_colors?.[1] || '#c4f36b'],
            typography: concept.typography ?? {},
            logo_prompt: concept.prompt,
            icon_concept: concept.icon_concept,
            layout: concept.layout,
            editable_metadata: {
              provider: concept.provider,
              provider_metadata: concept.provider_metadata,
            },
            generation_history: [],
            is_active: false,
            svg_markup: concept.svg_markup,
            source_app: body.sourceApp || 'logo-creator',
            aleya_business_id: project.aleya_business_id,
          })
          .select('*')
          .single();
        if (error) throw error;
        return json({ brandKit: data });
      }
      case 'list_brand_kits': {
        const { data, error } = await supabase
          .from('brand_kits')
          .select('*')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return json({ brandKits: data ?? [] });
      }
      case 'update_brand_kit': {
        if (!body.brandKitId) return json({ error: 'brandKitId required' }, 400);
        const { data, error } = await supabase
          .from('brand_kits')
          .update({ ...(body.patch || {}), updated_at: new Date().toISOString() })
          .eq('id', body.brandKitId)
          .select('*')
          .single();
        if (error) throw error;
        return json({ brandKit: data });
      }
      case 'set_active_brand_kit': {
        if (!body.brandKitId) return json({ error: 'brandKitId required' }, 400);
        const { data: kit, error: kitErr } = await supabase
          .from('brand_kits')
          .select('*')
          .eq('id', body.brandKitId)
          .single();
        if (kitErr) throw kitErr;
        await supabase.from('brand_kits').update({ is_active: false }).eq('workspace_id', kit.workspace_id);
        const { data, error } = await supabase
          .from('brand_kits')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('id', body.brandKitId)
          .select('*')
          .single();
        if (error) throw error;
        await supabase
          .from('workspaces')
          .update({ active_brand_kit_id: body.brandKitId })
          .eq('id', kit.workspace_id);
        return json({ brandKit: data });
      }
      case 'get_active_brand_kit': {
        const { data, error } = await supabase
          .from('brand_kits')
          .select('*')
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        return json({ brandKit: data?.[0] ?? null });
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});

async function ensureWorkspace(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  name: string,
) {
  const { data: existing, error: listError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (listError) throw listError;
  if (existing?.[0]) return existing[0];

  const { data, error } = await supabase
    .from('workspaces')
    .insert({ owner_id: ownerId, name })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
