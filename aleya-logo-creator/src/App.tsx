import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthPanel } from './components/AuthPanel';
import { LOGO_STYLES, type LogoStyle, renderLogoSvg } from './lib/logo-engine';
import { downloadPngFromSvg, downloadSvg } from './lib/export';
import { parseEntryContext, sourceLabel, type EntryContext } from './lib/entry';
import {
  createBrandKitFromConcept,
  createLogoProject,
  generateAndPersistConcepts,
  getActiveBrandKit,
  getLogoProject,
  listBrandKits,
  listLogoProjects,
  selectConcept,
  setActiveBrandKit,
  updateBrandKit,
  type BrandKit,
  type LogoConceptRow,
  type LogoProject,
  type ProjectBrief,
} from './lib/platform';
import { getSupabase, isSupabaseConfigured } from './lib/supabase';
import './App.css';

type View = 'studio' | 'kits' | 'kit-edit';

const DEFAULT_BRIEF: ProjectBrief = {
  businessName: '',
  tagline: '',
  industry: '',
  style: 'modern',
  primaryColor: '#0f2d26',
  secondaryColor: '#c4f36b',
  iconIdeas: '',
};

function App() {
  const entry = useMemo(() => parseEntryContext(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>('studio');
  const [brief, setBrief] = useState<ProjectBrief>({
    ...DEFAULT_BRIEF,
    aleyaBusinessId: entry.businessId,
    aleyaReturnUrl: entry.returnUrl,
  });
  const [project, setProject] = useState<LogoProject | null>(null);
  const [concepts, setConcepts] = useState<LogoConceptRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<LogoProject[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [activeKit, setActiveKit] = useState<BrandKit | null>(null);
  const [editingKit, setEditingKit] = useState<BrandKit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setBooting(false);
      return;
    }
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshLists();
  }, [session]);

  async function refreshLists() {
    try {
      const [p, k, a] = await Promise.all([
        listLogoProjects(),
        listBrandKits(),
        getActiveBrandKit(),
      ]);
      setProjects(p);
      setKits(k);
      setActiveKit(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace');
    }
  }

  async function handleGenerate(regenerate = false) {
    setError(null);
    setMessage(null);
    if (!brief.businessName.trim() || !brief.industry.trim()) {
      setError('Business name and industry are required.');
      return;
    }
    setBusy(regenerate ? 'Regenerating concepts…' : 'Generating concepts…');
    try {
      let current = project;
      if (!current || !regenerate) {
        current = await createLogoProject(brief);
        setProject(current);
      } else {
        // keep project, refresh brief colours on local state
      }
      const { concepts: rows } = await generateAndPersistConcepts(current.id, brief, {
        count: 6,
        regenerate,
      });
      setConcepts(rows);
      setSelectedId(null);
      setMessage(
        regenerate
          ? 'Fresh concepts generated. Pick a favourite to continue.'
          : 'Concepts ready. Select a favourite, then create a Brand Kit.',
      );
      await refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleSelect(conceptId: string) {
    if (!project) return;
    setBusy('Saving favourite…');
    setError(null);
    try {
      const row = await selectConcept(project.id, conceptId);
      setSelectedId(row.id);
      setConcepts((prev) =>
        prev.map((c) => ({ ...c, is_selected: c.id === row.id })),
      );
      setMessage('Favourite selected. Create a Brand Kit to use it across Aleya apps.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select concept');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateBrandKit() {
    if (!project) return;
    const concept = concepts.find((c) => c.id === selectedId || c.is_selected);
    if (!concept) {
      setError('Select a favourite concept first.');
      return;
    }
    setBusy('Creating Brand Kit…');
    setError(null);
    try {
      const kit = await createBrandKitFromConcept({
        project,
        concept,
        sourceApp:
          entry.source === 'aboss'
            ? 'aboss'
            : entry.source === 'aleya-invoicing'
              ? 'aleya-invoicing'
              : 'logo-creator',
      });
      setMessage(`Brand Kit “${kit.name}” created.`);
      await refreshLists();
      setEditingKit(kit);
      setView('kit-edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brand Kit creation failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleSetActive(kitId: string) {
    setBusy('Setting active Brand Kit…');
    setError(null);
    try {
      const kit = await setActiveBrandKit(kitId);
      setActiveKit(kit);
      setMessage(`“${kit.name}” is now the active Brand Kit for this workspace.`);
      await refreshLists();
      maybeReturn(entry, kit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set active kit');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveKit() {
    if (!editingKit) return;
    setBusy('Saving Brand Kit…');
    setError(null);
    try {
      const saved = await updateBrandKit(editingKit.id, {
        name: editingKit.name,
        business_name: editingKit.business_name,
        tagline: editingKit.tagline,
        primary_colors: editingKit.primary_colors,
        secondary_colors: editingKit.secondary_colors,
        svg_markup: editingKit.svg_markup,
      });
      setEditingKit(saved);
      setMessage('Brand Kit updated.');
      await refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function openProject(projectId: string) {
    setBusy('Opening project…');
    setError(null);
    try {
      const { project: p, concepts: rows } = await getLogoProject(projectId);
      setProject(p);
      setConcepts(rows);
      setSelectedId(rows.find((c) => c.is_selected)?.id ?? p.selected_concept_id);
      setBrief({
        businessName: p.business_name,
        tagline: p.tagline ?? '',
        industry: p.industry,
        style: (LOGO_STYLES.includes(p.style as LogoStyle) ? p.style : 'modern') as LogoStyle,
        primaryColor: p.preferred_colors[0] || '#0f2d26',
        secondaryColor: p.preferred_colors[1] || '#c4f36b',
        iconIdeas: p.icon_ideas ?? '',
        aleyaBusinessId: p.aleya_business_id,
        aleyaReturnUrl: p.aleya_return_url,
      });
      setView('studio');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open project');
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setSession(null);
    setProject(null);
    setConcepts([]);
    setKits([]);
  }

  if (booting) {
    return (
      <div className="app-boot">
        <p>Loading ALEYA Logo Creator…</p>
      </div>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="app-shell">
        <Hero entry={entry} />
        <section className="panel config-missing">
          <h2>Configure environment</h2>
          <p>
            Copy <code>.env.example</code> to <code>.env</code> and set{' '}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> for the shared
            Aleya Supabase project.
          </p>
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <Hero entry={entry} />
        <div className="auth-layout">
          <AuthPanel onAuthed={() => void refreshLists()} />
          <aside className="hero-aside" aria-label="Product highlights">
            <h2>Shared brand platform</h2>
            <p>
              Generate vector logo concepts, save Brand Kits, and sync the active kit with ABoss and
              Aleya Invoicing through one Supabase backend.
            </p>
            <ul>
              <li>Multi-concept generation + regenerate</li>
              <li>Brand Kits with SVG / PNG export</li>
              <li>Active kit sync across products</li>
            </ul>
          </aside>
        </div>
      </div>
    );
  }

  const selected = concepts.find((c) => c.id === selectedId || c.is_selected) ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <strong>ALEYA Logo Creator</strong>
            <span className="muted">{sourceLabel(entry.source)}</span>
          </div>
        </div>
        <nav className="topnav" aria-label="Primary">
          <button
            type="button"
            className={view === 'studio' ? 'is-active' : ''}
            onClick={() => setView('studio')}
          >
            Studio
          </button>
          <button
            type="button"
            className={view === 'kits' || view === 'kit-edit' ? 'is-active' : ''}
            onClick={() => {
              setView('kits');
              setEditingKit(null);
            }}
          >
            Brand Kits
          </button>
        </nav>
        <div className="topbar-actions">
          {activeKit ? (
            <span className="active-chip" title="Active Brand Kit">
              Active: {activeKit.name}
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <Hero entry={entry} compact />

      {(message || error || busy) && (
        <div className="status-row" role="status">
          {busy ? <p className="status busy">{busy}</p> : null}
          {message ? <p className="status ok">{message}</p> : null}
          {error ? (
            <p className="status err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}

      {view === 'studio' ? (
        <main className="studio">
          <section className="panel brief-panel">
            <h2>Brand brief</h2>
            <p className="lede">Describe the business — we generate multiple vector concepts.</p>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleGenerate(false);
              }}
            >
              <label className="field">
                <span>Business name</span>
                <input
                  required
                  maxLength={120}
                  value={brief.businessName}
                  onChange={(e) => setBrief((b) => ({ ...b, businessName: e.target.value }))}
                  autoComplete="organization"
                />
              </label>
              <label className="field">
                <span>
                  Tagline <span className="muted">(optional)</span>
                </span>
                <input
                  maxLength={160}
                  value={brief.tagline ?? ''}
                  onChange={(e) => setBrief((b) => ({ ...b, tagline: e.target.value }))}
                  placeholder="Short supporting line"
                />
              </label>
              <label className="field">
                <span>Industry</span>
                <input
                  required
                  maxLength={80}
                  value={brief.industry}
                  onChange={(e) => setBrief((b) => ({ ...b, industry: e.target.value }))}
                  placeholder="e.g. Scaffold hire, Cafe, Consulting"
                />
              </label>
              <label className="field">
                <span>Style</span>
                <select
                  value={brief.style}
                  onChange={(e) =>
                    setBrief((b) => ({ ...b, style: e.target.value as LogoStyle }))
                  }
                >
                  {LOGO_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {style.charAt(0).toUpperCase() + style.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="color-row">
                <label className="field">
                  <span>Primary</span>
                  <input
                    type="color"
                    value={brief.primaryColor}
                    onChange={(e) => setBrief((b) => ({ ...b, primaryColor: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Secondary</span>
                  <input
                    type="color"
                    value={brief.secondaryColor}
                    onChange={(e) => setBrief((b) => ({ ...b, secondaryColor: e.target.value }))}
                  />
                </label>
              </div>
              <label className="field">
                <span>Icon ideas</span>
                <input
                  maxLength={200}
                  value={brief.iconIdeas ?? ''}
                  onChange={(e) => setBrief((b) => ({ ...b, iconIdeas: e.target.value }))}
                  placeholder="leaf, building, star, coffee…"
                />
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>
                  Generate concepts
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!project || Boolean(busy)}
                  onClick={() => void handleGenerate(true)}
                >
                  Regenerate
                </button>
              </div>
            </form>

            {projects.length > 0 ? (
              <div className="project-list">
                <h3>Recent projects</h3>
                <ul>
                  {projects.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => void openProject(p.id)}>
                        {p.business_name}
                        <span className="muted">{p.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="panel results-panel">
            <div className="panel-head">
              <div>
                <h2>Concepts</h2>
                <p className="lede">Select a favourite, then create a Brand Kit.</p>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selected || Boolean(busy)}
                  onClick={() => void handleCreateBrandKit()}
                >
                  Create Brand Kit
                </button>
                {selected?.svg_markup ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        downloadSvg(
                          selected.svg_markup!,
                          `${brief.businessName || 'logo'}.svg`,
                        )
                      }
                    >
                      Export SVG
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void downloadPngFromSvg(
                          selected.svg_markup!,
                          `${brief.businessName || 'logo'}.png`,
                        )
                      }
                    >
                      Export PNG
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {concepts.length === 0 ? (
              <div className="empty">
                <strong>No concepts yet</strong>
                <p>Fill in the brief and generate to see logo options here.</p>
              </div>
            ) : (
              <div className="concept-grid">
                {concepts.map((concept) => {
                  const isSelected = concept.id === selectedId || concept.is_selected;
                  return (
                    <article
                      key={concept.id}
                      className={`concept-card${isSelected ? ' is-selected' : ''}`}
                    >
                      <div
                        className="concept-preview"
                        dangerouslySetInnerHTML={{
                          __html:
                            concept.svg_markup ||
                            renderLogoSvg({
                              id: concept.id,
                              businessName: brief.businessName || 'Brand',
                              tagline: brief.tagline || null,
                              industry: brief.industry || 'General',
                              style: brief.style,
                              primaryColor: brief.primaryColor,
                              secondaryColor: brief.secondaryColor,
                              iconIdea: brief.iconIdeas || 'mark',
                              layout: 'lockup',
                              markShape: 'circle',
                              monogram: 'AL',
                              seed: concept.id,
                            }),
                        }}
                      />
                      <div className="concept-meta">
                        <strong>{concept.layout}</strong>
                        <span>
                          {concept.icon_concept || 'mark'} · {concept.provider}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleSelect(concept.id)}
                      >
                        {isSelected ? 'Favourite' : 'Use this logo'}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      ) : null}

      {view === 'kits' ? (
        <main className="kits">
          <section className="panel">
            <h2>Brand Kits</h2>
            <p className="lede">Reopen, edit, export, or set the active kit for connected apps.</p>
            {kits.length === 0 ? (
              <div className="empty">
                <strong>No Brand Kits yet</strong>
                <p>Generate concepts in Studio and create a kit from your favourite.</p>
              </div>
            ) : (
              <ul className="kit-list">
                {kits.map((kit) => (
                  <li key={kit.id} className={kit.is_active ? 'is-active' : ''}>
                    <div className="kit-preview">
                      {kit.svg_markup ? (
                        <div dangerouslySetInnerHTML={{ __html: kit.svg_markup }} />
                      ) : (
                        <span className="muted">No preview</span>
                      )}
                    </div>
                    <div className="kit-body">
                      <strong>{kit.name}</strong>
                      <span>
                        {kit.business_name}
                        {kit.is_active ? ' · Active' : ''}
                      </span>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingKit(kit);
                            setView('kit-edit');
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={kit.is_active}
                          onClick={() => void handleSetActive(kit.id)}
                        >
                          Set active
                        </button>
                        {kit.svg_markup ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => downloadSvg(kit.svg_markup!, `${kit.name}.svg`)}
                            >
                              SVG
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                void downloadPngFromSvg(kit.svg_markup!, `${kit.name}.png`)
                              }
                            >
                              PNG
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      ) : null}

      {view === 'kit-edit' && editingKit ? (
        <main className="kit-edit">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Edit Brand Kit</h2>
                <p className="lede">Update naming and colours. SVG markup stays editable.</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setView('kits')}>
                Back to kits
              </button>
            </div>
            <div className="kit-edit-grid">
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveKit();
                }}
              >
                <label className="field">
                  <span>Kit name</span>
                  <input
                    value={editingKit.name}
                    onChange={(e) => setEditingKit({ ...editingKit, name: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Business name</span>
                  <input
                    value={editingKit.business_name}
                    onChange={(e) =>
                      setEditingKit({ ...editingKit, business_name: e.target.value })
                    }
                    required
                  />
                </label>
                <label className="field">
                  <span>Tagline</span>
                  <input
                    value={editingKit.tagline ?? ''}
                    onChange={(e) =>
                      setEditingKit({ ...editingKit, tagline: e.target.value || null })
                    }
                  />
                </label>
                <div className="color-row">
                  <label className="field">
                    <span>Primary</span>
                    <input
                      type="color"
                      value={editingKit.primary_colors[0] || '#0f2d26'}
                      onChange={(e) =>
                        setEditingKit({
                          ...editingKit,
                          primary_colors: [e.target.value, ...(editingKit.primary_colors.slice(1) || [])],
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Secondary</span>
                    <input
                      type="color"
                      value={editingKit.secondary_colors[0] || '#c4f36b'}
                      onChange={(e) =>
                        setEditingKit({
                          ...editingKit,
                          secondary_colors: [
                            e.target.value,
                            ...(editingKit.secondary_colors.slice(1) || []),
                          ],
                        })
                      }
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={editingKit.is_active}
                    onClick={() => void handleSetActive(editingKit.id)}
                  >
                    Set as active
                  </button>
                </div>
              </form>
              <div className="kit-edit-preview">
                {editingKit.svg_markup ? (
                  <div dangerouslySetInnerHTML={{ __html: editingKit.svg_markup }} />
                ) : (
                  <p className="muted">No SVG stored on this kit.</p>
                )}
              </div>
            </div>
          </section>
        </main>
      ) : null}

      {entry.returnUrl ? (
        <footer className="return-bar">
          <a className="btn btn-secondary" href={entry.returnUrl}>
            Return to {entry.source === 'aboss' ? 'ABoss' : 'Aleya Invoicing'}
          </a>
        </footer>
      ) : null}
    </div>
  );
}

function Hero({ entry, compact = false }: { entry: EntryContext; compact?: boolean }) {
  return (
    <section className={`hero${compact ? ' hero-compact' : ''}`}>
      <div className="hero-atmosphere" aria-hidden="true" />
      <div className="hero-content">
        <p className="eyebrow">Aleya brand platform</p>
        <h1 className="brand-hero">ALEYA Logo Creator</h1>
        {!compact ? (
          <>
            <p className="hero-lede">
              Craft vector logos and Brand Kits that sync across ABoss and Aleya Invoicing.
            </p>
            <p className="hero-source">{sourceLabel(entry.source)}</p>
          </>
        ) : (
          <p className="hero-lede">Generate · select · brand kit · export</p>
        )}
      </div>
    </section>
  );
}

function maybeReturn(entry: EntryContext, kit: BrandKit) {
  if (!entry.returnUrl) return;
  try {
    const url = new URL(entry.returnUrl, window.location.origin);
    url.searchParams.set('brandKitId', kit.id);
    url.searchParams.set('active', '1');
    // Soft prompt — do not auto-navigate away from the creator.
    console.info('Return URL ready:', url.toString());
  } catch {
    // ignore invalid return URLs
  }
}

export default App;
