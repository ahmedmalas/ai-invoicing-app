import type { LogoConcept, LogoStyle } from './logo-engine';
import {
  conceptToEnginePayload,
  generateLogoConcepts,
  renderLogoSvg,
} from './logo-engine';
import { getAnonKey, getSupabase, getSupabaseUrl } from './supabase';

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'selected' | 'archived';

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  active_brand_kit_id: string | null;
  created_at: string;
}

export interface LogoProject {
  id: string;
  workspace_id: string;
  owner_id: string;
  business_name: string;
  tagline: string | null;
  industry: string;
  personality: string;
  style: string;
  preferred_colors: string[];
  avoid_colors: string[];
  icon_ideas: string | null;
  typography_direction: string;
  layout_direction: string;
  status: ProjectStatus;
  selected_concept_id: string | null;
  aleya_business_id: string | null;
  aleya_return_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogoConceptRow {
  id: string;
  project_id: string;
  owner_id: string;
  job_id: string | null;
  title: string;
  prompt: string;
  icon_concept: string | null;
  layout: string;
  palette: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    foreground?: string;
  };
  typography: Record<string, unknown>;
  provider: string;
  provider_metadata: Record<string, unknown>;
  svg_markup: string | null;
  is_selected: boolean;
  created_at: string;
}

export interface BrandKit {
  id: string;
  workspace_id: string;
  owner_id: string;
  project_id: string;
  concept_id: string;
  name: string;
  business_name: string;
  tagline: string | null;
  primary_colors: string[];
  secondary_colors: string[];
  typography: Record<string, unknown>;
  logo_prompt: string | null;
  icon_concept: string | null;
  layout: string | null;
  editable_metadata: Record<string, unknown>;
  generation_history: unknown[];
  is_active: boolean;
  svg_markup: string | null;
  source_app: string;
  aleya_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBrief {
  businessName: string;
  tagline?: string;
  industry: string;
  style: LogoStyle;
  primaryColor: string;
  secondaryColor: string;
  iconIdeas?: string;
  aleyaBusinessId?: string | null;
  aleyaReturnUrl?: string | null;
}

type EdgeAction =
  | 'ensure_workspace'
  | 'create_project'
  | 'list_projects'
  | 'get_project'
  | 'generate_concepts'
  | 'select_concept'
  | 'create_brand_kit'
  | 'list_brand_kits'
  | 'update_brand_kit'
  | 'set_active_brand_kit'
  | 'get_active_brand_kit';

async function getAccessToken(): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

async function callLogoPlatform<T>(
  action: EdgeAction,
  payload: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${getSupabaseUrl()}/functions/v1/logo-platform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: getAnonKey(),
      },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[logo-platform] ${action} failed (${res.status}):`, text);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[logo-platform] ${action} unavailable:`, err);
    return null;
  }
}

function requireUserId(userId: string | undefined): string {
  if (!userId) throw new Error('Not signed in');
  return userId;
}

export async function ensureWorkspace(displayName = 'My Brand Workspace'): Promise<Workspace> {
  const edge = await callLogoPlatform<{ workspace: Workspace }>('ensure_workspace', {
    name: displayName,
  });
  if (edge?.workspace) return edge.workspace;

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = requireUserId(user?.id);

  const { data: existing, error: listError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (listError) throw listError;
  if (existing?.[0]) return existing[0] as Workspace;

  const { data, error } = await supabase
    .from('workspaces')
    .insert({ owner_id: ownerId, name: displayName })
    .select('*')
    .single();
  if (error) throw error;
  return data as Workspace;
}

export async function createLogoProject(brief: ProjectBrief): Promise<LogoProject> {
  const workspace = await ensureWorkspace(brief.businessName);
  const edge = await callLogoPlatform<{ project: LogoProject }>('create_project', {
    workspaceId: workspace.id,
    brief,
  });
  if (edge?.project) return edge.project;

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = requireUserId(user?.id);

  const { data, error } = await supabase
    .from('logo_projects')
    .insert({
      workspace_id: workspace.id,
      owner_id: ownerId,
      business_name: brief.businessName.trim(),
      tagline: brief.tagline?.trim() || null,
      industry: brief.industry.trim(),
      personality: 'trustworthy',
      style: brief.style,
      preferred_colors: [brief.primaryColor, brief.secondaryColor],
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
  return data as LogoProject;
}

export async function listLogoProjects(): Promise<LogoProject[]> {
  const edge = await callLogoPlatform<{ projects: LogoProject[] }>('list_projects');
  if (edge?.projects) return edge.projects;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('logo_projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LogoProject[];
}

export async function getLogoProject(projectId: string): Promise<{
  project: LogoProject;
  concepts: LogoConceptRow[];
}> {
  const edge = await callLogoPlatform<{ project: LogoProject; concepts: LogoConceptRow[] }>(
    'get_project',
    { projectId },
  );
  if (edge?.project) return { project: edge.project, concepts: edge.concepts ?? [] };

  const supabase = getSupabase();
  const { data: project, error } = await supabase
    .from('logo_projects')
    .select('*')
    .eq('id', projectId)
    .single();
  if (error) throw error;

  const { data: concepts, error: cErr } = await supabase
    .from('logo_concepts')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;

  return { project: project as LogoProject, concepts: (concepts ?? []) as LogoConceptRow[] };
}

function conceptToRowFields(concept: LogoConcept, index: number) {
  return {
    title: `${concept.style} ${concept.layout} ${index + 1}`,
    prompt: [
      concept.businessName,
      concept.industry,
      concept.style,
      concept.iconIdea,
      concept.layout,
      concept.markShape,
    ].join(' · '),
    icon_concept: concept.iconIdea,
    layout: concept.layout,
    palette: {
      primary: concept.primaryColor,
      secondary: concept.secondaryColor,
      accent: concept.secondaryColor,
      background: '#fbfaf6',
      foreground: concept.primaryColor,
    },
    typography: { display: 'Georgia', body: 'system-ui' },
    provider: 'aleya-logo-engine',
    provider_metadata: {
      seed: concept.seed,
      markShape: concept.markShape,
      monogram: concept.monogram,
      engineConceptId: concept.id,
      style: concept.style,
    },
    svg_markup: renderLogoSvg(concept),
    is_selected: false,
  };
}

export async function generateAndPersistConcepts(
  projectId: string,
  brief: ProjectBrief,
  options?: { count?: number; regenerate?: boolean },
): Promise<{ concepts: LogoConceptRow[]; engineConcepts: LogoConcept[] }> {
  const engineConcepts = generateLogoConcepts({
    businessName: brief.businessName,
    tagline: brief.tagline,
    industry: brief.industry,
    style: brief.style,
    primaryColor: brief.primaryColor,
    secondaryColor: brief.secondaryColor,
    iconIdeas: brief.iconIdeas,
    count: options?.count ?? 6,
  });

  const edge = await callLogoPlatform<{ concepts: LogoConceptRow[] }>('generate_concepts', {
    projectId,
    brief,
    concepts: engineConcepts.map((c, i) => ({
      ...conceptToRowFields(c, i),
      engine: conceptToEnginePayload(c),
    })),
    regenerate: Boolean(options?.regenerate),
  });
  if (edge?.concepts?.length) {
    return { concepts: edge.concepts, engineConcepts };
  }

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = requireUserId(user?.id);

  await supabase
    .from('logo_projects')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', projectId);

  const rows = engineConcepts.map((concept, index) => ({
    project_id: projectId,
    owner_id: ownerId,
    ...conceptToRowFields(concept, index),
  }));

  const { data, error } = await supabase.from('logo_concepts').insert(rows).select('*');
  if (error) throw error;

  await supabase
    .from('logo_projects')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', projectId);

  return { concepts: (data ?? []) as LogoConceptRow[], engineConcepts };
}

export async function selectConcept(
  projectId: string,
  conceptId: string,
): Promise<LogoConceptRow> {
  const edge = await callLogoPlatform<{ concept: LogoConceptRow }>('select_concept', {
    projectId,
    conceptId,
  });
  if (edge?.concept) return edge.concept;

  const supabase = getSupabase();

  await supabase.from('logo_concepts').update({ is_selected: false }).eq('project_id', projectId);

  const { data, error } = await supabase
    .from('logo_concepts')
    .update({ is_selected: true })
    .eq('id', conceptId)
    .eq('project_id', projectId)
    .select('*')
    .single();
  if (error) throw error;

  await supabase
    .from('logo_projects')
    .update({
      selected_concept_id: conceptId,
      status: 'selected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  return data as LogoConceptRow;
}

export async function createBrandKitFromConcept(input: {
  project: LogoProject;
  concept: LogoConceptRow;
  name?: string;
  sourceApp?: string;
}): Promise<BrandKit> {
  const edge = await callLogoPlatform<{ brandKit: BrandKit }>('create_brand_kit', {
    projectId: input.project.id,
    conceptId: input.concept.id,
    name: input.name,
    sourceApp: input.sourceApp ?? 'logo-creator',
  });
  if (edge?.brandKit) return edge.brandKit;

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = requireUserId(user?.id);
  const palette = input.concept.palette ?? {};

  const { data, error } = await supabase
    .from('brand_kits')
    .insert({
      workspace_id: input.project.workspace_id,
      owner_id: ownerId,
      project_id: input.project.id,
      concept_id: input.concept.id,
      name: input.name?.trim() || `${input.project.business_name} Brand Kit`,
      business_name: input.project.business_name,
      tagline: input.project.tagline,
      primary_colors: [palette.primary || input.project.preferred_colors[0] || '#0f2d26'].filter(
        Boolean,
      ),
      secondary_colors: [
        palette.secondary || input.project.preferred_colors[1] || '#c4f36b',
      ].filter(Boolean),
      typography: input.concept.typography ?? {},
      logo_prompt: input.concept.prompt,
      icon_concept: input.concept.icon_concept,
      layout: input.concept.layout,
      editable_metadata: {
        provider: input.concept.provider,
        provider_metadata: input.concept.provider_metadata,
      },
      generation_history: [],
      is_active: false,
      svg_markup: input.concept.svg_markup,
      source_app: input.sourceApp ?? 'logo-creator',
      aleya_business_id: input.project.aleya_business_id,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BrandKit;
}

export async function listBrandKits(): Promise<BrandKit[]> {
  const edge = await callLogoPlatform<{ brandKits: BrandKit[] }>('list_brand_kits');
  if (edge?.brandKits) return edge.brandKits;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BrandKit[];
}

export async function updateBrandKit(
  brandKitId: string,
  patch: Partial<
    Pick<BrandKit, 'name' | 'business_name' | 'tagline' | 'primary_colors' | 'secondary_colors' | 'svg_markup'>
  >,
): Promise<BrandKit> {
  const edge = await callLogoPlatform<{ brandKit: BrandKit }>('update_brand_kit', {
    brandKitId,
    patch,
  });
  if (edge?.brandKit) return edge.brandKit;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('brand_kits')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', brandKitId)
    .select('*')
    .single();
  if (error) throw error;
  return data as BrandKit;
}

export async function setActiveBrandKit(brandKitId: string): Promise<BrandKit> {
  const edge = await callLogoPlatform<{ brandKit: BrandKit }>('set_active_brand_kit', {
    brandKitId,
  });
  if (edge?.brandKit) return edge.brandKit;

  const supabase = getSupabase();
  const { data: kit, error: kitErr } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('id', brandKitId)
    .single();
  if (kitErr) throw kitErr;

  await supabase
    .from('brand_kits')
    .update({ is_active: false })
    .eq('workspace_id', (kit as BrandKit).workspace_id);

  const { data, error } = await supabase
    .from('brand_kits')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', brandKitId)
    .select('*')
    .single();
  if (error) throw error;

  await supabase
    .from('workspaces')
    .update({ active_brand_kit_id: brandKitId })
    .eq('id', (kit as BrandKit).workspace_id);

  return data as BrandKit;
}

export async function getActiveBrandKit(): Promise<BrandKit | null> {
  const edge = await callLogoPlatform<{ brandKit: BrandKit | null }>('get_active_brand_kit');
  if (edge && 'brandKit' in edge) return edge.brandKit;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as BrandKit | undefined) ?? null;
}

export function rowToEngineConcept(row: LogoConceptRow, project: LogoProject): LogoConcept | null {
  const meta = row.provider_metadata ?? {};
  const primary = row.palette?.primary || project.preferred_colors[0] || '#0f2d26';
  const secondary = row.palette?.secondary || project.preferred_colors[1] || '#c4f36b';
  const style = (typeof meta.style === 'string' ? meta.style : project.style) as LogoStyle;
  const layout = row.layout as LogoConcept['layout'];
  const markShape = (typeof meta.markShape === 'string'
    ? meta.markShape
    : 'circle') as LogoConcept['markShape'];

  if (!row.svg_markup) {
    return {
      id: typeof meta.engineConceptId === 'string' ? meta.engineConceptId : row.id,
      businessName: project.business_name,
      tagline: project.tagline,
      industry: project.industry,
      style,
      primaryColor: primary,
      secondaryColor: secondary,
      iconIdea: row.icon_concept || project.industry,
      layout,
      markShape,
      monogram: typeof meta.monogram === 'string' ? meta.monogram : project.business_name.slice(0, 2).toUpperCase(),
      seed: typeof meta.seed === 'string' ? meta.seed : row.id,
    };
  }

  return {
    id: typeof meta.engineConceptId === 'string' ? meta.engineConceptId : row.id,
    businessName: project.business_name,
    tagline: project.tagline,
    industry: project.industry,
    style,
    primaryColor: primary,
    secondaryColor: secondary,
    iconIdea: row.icon_concept || project.industry,
    layout,
    markShape,
    monogram: typeof meta.monogram === 'string' ? meta.monogram : project.business_name.slice(0, 2).toUpperCase(),
    seed: typeof meta.seed === 'string' ? meta.seed : row.id,
  };
}
