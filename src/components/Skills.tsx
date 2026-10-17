import { useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Globe,
  Link,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { agentRoles, type Agent, type Role, type Skill } from '../../shared/types';
import type { Request } from '../api';
import { curatedSkills, makeCuratedSkillMd } from '../skills';

const CATEGORIES = ['all', 'developer', 'marketing', 'writer', 'analyst', 'devops', 'security', 'gamedev', 'general'];

function buildSkillMd(name: string, description: string, category: string, body: string): string {
  return `---\nname: "${name}"\ndescription: "${description}"\ncategory: "${category}"\n---\n\n${body}`;
}

function extractBody(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
}

function extractField(content: string, field: string): string {
  return content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
}

// ── Skill Modal ───────────────────────────────────────────────────────────────

interface SkillModalProps {
  mode: 'new' | 'edit';
  skill?: Skill | null;
  openaiConfigured: boolean;
  request: Request;
  onSave: (skill: Skill) => void;
  onClose: () => void;
}

function SkillModal({ mode, skill, openaiConfigured, request, onSave, onClose }: SkillModalProps) {
  const [tab, setTab] = useState<'write' | 'generate'>('write');
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [category, setCategory] = useState(skill?.category ?? 'general');
  const [body, setBody] = useState(skill ? extractBody(skill.content) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [genDesc, setGenDesc] = useState('');
  const [generated, setGenerated] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    if (!body.trim()) { setError('Content is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const content = buildSkillMd(name.trim(), description.trim(), category, body.trim());
      let saved: Skill;
      if (mode === 'edit' && skill) {
        saved = await request<Skill>(`/skills/${skill.id}`, 'PUT', { content });
      } else {
        saved = await request<Skill>('/skills', 'POST', { content, source: 'manual' });
      }
      onSave(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (!genDesc.trim()) return;
    setGenerating(true);
    setGenError('');
    setGenerated('');
    try {
      const { content } = await request<{ content: string }>('/skills/generate', 'POST', { description: genDesc.trim() });
      setGenerated(content);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function useGenerated() {
    setName(extractField(generated, 'name'));
    setDescription(extractField(generated, 'description'));
    setCategory(extractField(generated, 'category') || 'general');
    setBody(extractBody(generated));
    setTab('write');
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal skill-modal">
        <div className="modal-header">
          <h2>{mode === 'edit' ? 'Edit skill' : 'New skill'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="skill-modal-tabs">
          <button className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>
            <Pencil size={14} /> Write
          </button>
          <button
            className={tab === 'generate' ? 'active' : ''}
            onClick={() => setTab('generate')}
            disabled={!openaiConfigured}
            title={!openaiConfigured ? 'Add an OpenAI key in Settings to use AI generation' : undefined}
          >
            <Sparkles size={14} /> Generate with AI
          </button>
        </div>

        {tab === 'write' && (
          <div className="skill-modal-body">
            <div className="form-row-2">
              <label className="form-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Code Review" />
              </label>
              <label className="form-field">
                <span>Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line summary of what this skill does" />
            </label>
            <label className="form-field skill-content-field">
              <span>Instructions</span>
              <textarea
                className="skill-editor"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'# Skill Name\n\nWrite clear, actionable instructions for the agent.\n\nBest practices:\n- Use markdown structure\n- Keep instructions focused\n- Include examples if helpful'}
                rows={12}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
          </div>
        )}

        {tab === 'generate' && (
          <div className="skill-modal-body">
            <label className="form-field">
              <span>Describe the skill you want to create</span>
              <textarea
                className="skill-editor"
                value={genDesc}
                onChange={(e) => setGenDesc(e.target.value)}
                placeholder="e.g. A skill for reviewing pull requests — check for code quality, test coverage, security issues, and clear commit messages."
                rows={5}
              />
            </label>
            <button className="button primary" onClick={() => void generate()} disabled={generating || !genDesc.trim()}>
              {generating ? 'Generating…' : <><Sparkles size={14} /> Generate</>}
            </button>
            {genError && <p className="form-error">{genError}</p>}
            {generated && (
              <div className="skill-generated-preview">
                <div className="skill-generated-header">
                  <span>Generated skill</span>
                  <button className="button secondary small" onClick={useGenerated}>
                    <Check size={13} /> Use this
                  </button>
                </div>
                <pre className="skill-generated-content">{generated}</pre>
              </div>
            )}
          </div>
        )}

        <div className="form-footer">
          <button className="button secondary" onClick={onClose}>Cancel</button>
          {tab === 'write' && (
            <button className="button primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create skill'}
            </button>
          )}
          {tab === 'generate' && generated && (
            <button className="button primary" onClick={useGenerated}>Edit & Save</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Install Dropdown ──────────────────────────────────────────────────────────

interface InstallDropdownProps {
  skill: Skill;
  agents: Agent[];
  installedOn: Set<string>;
  onInstall: (agentId: string) => void;
}

function InstallDropdown({ skill, agents, installedOn, onInstall }: InstallDropdownProps) {
  const [open, setOpen] = useState(false);
  const available = agents.filter((a) => !installedOn.has(a.id));
  if (!agents.length) return null;
  return (
    <div className="skill-install-dropdown">
      <button className="button secondary small" onClick={() => setOpen((v) => !v)} title="Install to agent">
        Install <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="skill-install-backdrop" onClick={() => setOpen(false)} />
          <div className="skill-install-menu">
            {available.length === 0 ? (
              <span className="skill-install-empty">Installed on all agents</span>
            ) : (
              available.map((agent) => (
                <button key={agent.id} onClick={() => { onInstall(agent.id); setOpen(false); }}>
                  {agent.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Role Modal ────────────────────────────────────────────────────────────────

interface RoleModalProps {
  mode: 'new' | 'edit';
  role?: Role | null;
  initialName?: string;
  skills: Skill[];
  request: Request;
  onSave: () => void;
  onClose: () => void;
}

function RoleModal({ mode, role, initialName, skills, request, onSave, onClose }: RoleModalProps) {
  const [name, setName] = useState(role?.name ?? initialName ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(role?.skillIds ?? []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filtered = skills.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.category ?? '').includes(search.toLowerCase())
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) { setError('Role name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, skillIds: [...selectedIds] };
      if (mode === 'edit' && role) {
        await request(`/roles/${role.id}`, 'PUT', body);
      } else {
        await request('/roles', 'POST', body);
      }
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal skill-modal">
        <div className="modal-header">
          <h2>{mode === 'edit' ? 'Edit role' : 'New role'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="skill-modal-body">
          <label className="form-field">
            <span>Role name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Game Developer" />
          </label>
          <label className="form-field">
            <span>Description <span className="optional">optional</span></span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agents specializing in game development and Unity" />
          </label>
          <div className="form-field">
            <span className="role-skill-picker-label">
              Skills ({selectedIds.size} selected)
              {skills.length === 0 && <span className="field-hint"> — add skills to your library first</span>}
            </span>
            {skills.length > 0 && (
              <>
                <label className="search-field role-skill-search">
                  <Search size={13} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter skills…" />
                </label>
                <div className="role-skill-list">
                  {filtered.map((s) => (
                    <label key={s.id} className={`role-skill-item ${selectedIds.has(s.id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggle(s.id)} />
                      <div className="role-skill-item-info">
                        <span className="role-skill-item-name">{s.name}</span>
                        {s.category && <span className="skill-category-badge">{s.category}</span>}
                      </div>
                    </label>
                  ))}
                  {filtered.length === 0 && <p className="role-skill-empty">No skills match your search.</p>}
                </div>
              </>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="form-footer">
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Skills View ──────────────────────────────────────────────────────────

export default function SkillsView({
  skills,
  roles,
  agents,
  openaiConfigured,
  request,
}: {
  skills: Skill[];
  roles: Role[];
  agents: Agent[];
  openaiConfigured: boolean;
  request: Request;
}) {
  const [tab, setTab] = useState<'library' | 'catalog' | 'import' | 'roles'>('library');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; skill?: Skill } | null>(null);
  const [roleModal, setRoleModal] = useState<{ mode: 'new' | 'edit'; role?: Role; initialName?: string } | null>(null);
  const [toast, setToast] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  function getInstalledOn(skill: Skill): Set<string> {
    const installed = new Set<string>();
    for (const agent of agents) {
      if ((agent.skills ?? []).some((s) => s.source === `library:${skill.id}` || s.content === skill.content)) {
        installed.add(agent.id);
      }
    }
    return installed;
  }

  async function installToAgent(skill: Skill, agentId: string) {
    try {
      await request(`/agents/${agentId}/skills`, 'POST', { content: skill.content, source: `library:${skill.id}` });
      showToast(`Installed "${skill.name}" to ${agents.find((a) => a.id === agentId)?.name ?? 'agent'}.`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function deleteSkill(id: string) {
    try {
      await request(`/skills/${id}`, 'DELETE');
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function deleteRole(id: string) {
    try {
      await request(`/roles/${id}`, 'DELETE');
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function installFromUrl() {
    if (!urlInput.trim()) return;
    setUrlBusy(true);
    setUrlError('');
    try {
      await request('/skills/fetch', 'POST', { url: urlInput.trim() });
      setUrlInput('');
      showToast('Skill installed from URL.');
      setTab('library');
    } catch (e) {
      setUrlError((e as Error).message);
    } finally {
      setUrlBusy(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      if (!content) return;
      try {
        await request('/skills', 'POST', { content, source: `file:${file.name}` });
        showToast(`"${file.name}" added to your library.`);
        setTab('library');
      } catch (err) {
        showToast((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function addCuratedToLibrary(slug: string) {
    const curated = curatedSkills.find((s) => s.slug === slug);
    if (!curated) return;
    setCatalogBusy(slug);
    try {
      if (curated.url) {
        await request('/skills/fetch', 'POST', { url: curated.url, source: `curated:${slug}` });
      } else {
        await request('/skills', 'POST', { content: makeCuratedSkillMd(curated), source: `curated:${slug}` });
      }
      showToast(`"${curated.name}" added to your library.`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setCatalogBusy('');
    }
  }

  const librarySkillSlugs = new Set(
    skills.filter((s) => s.source?.startsWith('curated:')).map((s) => s.source!.replace('curated:', ''))
  );

  const filtered = skills.filter((s) => {
    const matchesSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const catalogFiltered = curatedSkills.filter((s) => categoryFilter === 'all' || s.category === categoryFilter);

  return (
    <div className="skills-library">
      <div className="skills-library-header">
        <div className="skills-library-title">
          <Puzzle size={22} />
          <h1>Skills<span className="count-badge">{skills.length}</span></h1>
        </div>
        <div className="skills-library-actions">
          <button className="button secondary small" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Upload .md
          </button>
          <input ref={fileInputRef} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={handleFileUpload} />
          <button className="button primary small" onClick={() => setModal({ mode: 'new' })}>
            <Plus size={14} /> New skill
          </button>
        </div>
      </div>

      <div className="skills-outer-tabs">
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          <BookOpen size={14} /> My Skills
        </button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
          <Globe size={14} /> Catalog
        </button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          <Link size={14} /> Import
        </button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>
          <Users size={14} /> Roles
          {(() => {
            const n = new Set([...agents.map((a) => a.role).filter(Boolean), ...roles.map((r) => r.name.toLowerCase())]).size;
            return n > 0 ? <span className="tab-count">{n}</span> : null;
          })()}
        </button>
      </div>

      {(tab === 'library' || tab === 'catalog') && (
        <div className="skills-filters">
          {tab === 'library' && (
            <label className="search-field skills-search">
              <Search size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills…" />
            </label>
          )}
          <div className="skills-category-chips">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`category-chip ${categoryFilter === c ? 'active' : ''}`}
                onClick={() => setCategoryFilter(c)}
              >
                {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── My Skills ── */}
      {tab === 'library' && (
        <>
          {filtered.length === 0 ? (
            <div className="skills-empty">
              <Puzzle size={28} />
              <p>{skills.length === 0 ? 'No skills yet. Browse the catalog or create your own.' : 'No skills match your filters.'}</p>
              {skills.length === 0 && (
                <div className="skills-empty-actions">
                  <button className="button secondary" onClick={() => setTab('catalog')}>Browse catalog</button>
                  <button className="button primary" onClick={() => setModal({ mode: 'new' })}>Create skill</button>
                </div>
              )}
            </div>
          ) : (
            <div className="skill-cards-grid">
              {filtered.map((skill) => {
                const installedOn = getInstalledOn(skill);
                return (
                  <div key={skill.id} className="skill-card">
                    <div className="skill-card-top">
                      {skill.category && <span className="skill-category-badge">{skill.category}</span>}
                      <div className="skill-card-actions">
                        <button className="icon-button" title="Edit" onClick={() => setModal({ mode: 'edit', skill })}>
                          <Pencil size={13} />
                        </button>
                        <button className="icon-button danger" title="Delete" onClick={() => void deleteSkill(skill.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <h3 className="skill-card-name">{skill.name}</h3>
                    <p className="skill-card-desc">{skill.description}</p>
                    <div className="skill-card-footer">
                      {installedOn.size > 0 && (
                        <span className="skill-installed-count">
                          <Check size={11} /> {installedOn.size} agent{installedOn.size > 1 ? 's' : ''}
                        </span>
                      )}
                      <InstallDropdown
                        skill={skill}
                        agents={agents}
                        installedOn={installedOn}
                        onInstall={(agentId) => void installToAgent(skill, agentId)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Catalog ── */}
      {tab === 'catalog' && (
        <div className="skill-cards-grid">
          {catalogFiltered.map((curated) => {
            const inLibrary = librarySkillSlugs.has(curated.slug);
            const busy = catalogBusy === curated.slug;
            return (
              <div key={curated.slug} className={`skill-card ${inLibrary ? 'skill-card-installed' : ''}`}>
                <div className="skill-card-top">
                  <span className="skill-category-badge">{curated.category}</span>
                  {curated.source && (
                    <a href={curated.source} target="_blank" rel="noreferrer" className="skill-source-link" title="Source">
                      <Globe size={11} />
                    </a>
                  )}
                </div>
                <h3 className="skill-card-name">{curated.name}</h3>
                <p className="skill-card-desc">{curated.description}</p>
                <div className="skill-card-footer">
                  <button
                    className={`button ${inLibrary ? 'secondary' : 'primary'} small`}
                    disabled={inLibrary || busy}
                    onClick={() => void addCuratedToLibrary(curated.slug)}
                  >
                    {busy ? 'Adding…' : inLibrary ? <><Check size={12} /> In library</> : 'Add to library'}
                  </button>
                </div>
              </div>
            );
          })}
          {catalogFiltered.length === 0 && (
            <div className="skills-empty" style={{ gridColumn: '1 / -1' }}>
              <p>No catalog skills in this category.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Import ── */}
      {tab === 'import' && (
        <div className="skills-import-panel">
          <div className="skills-import-section">
            <h3 className="skills-import-heading"><Upload size={15} /> Upload a file</h3>
            <p className="skills-url-hint">Upload a <code>.md</code> file with SKILL.md frontmatter (<code>name</code>, <code>description</code>, <code>category</code>).</p>
            <button className="button secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> Choose file…
            </button>
            <input ref={fileInputRef} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={handleFileUpload} />
          </div>

          <div className="skills-import-divider" />

          <div className="skills-import-section">
            <h3 className="skills-import-heading"><Link size={15} /> Import from URL</h3>
            <p className="skills-url-hint">Paste the URL of a raw <code>SKILL.md</code> file (GitHub raw, Gist, or any direct link).</p>
            <div className="skills-url-form">
              <input
                type="url"
                placeholder="https://raw.githubusercontent.com/…/skill.md"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void installFromUrl()}
              />
              <button className="button primary" onClick={() => void installFromUrl()} disabled={urlBusy || !urlInput.trim()}>
                {urlBusy ? 'Fetching…' : 'Import'}
              </button>
            </div>
            {urlError && <p className="form-error">{urlError}</p>}
          </div>
        </div>
      )}

      {/* ── Roles ── */}
      {tab === 'roles' && (() => {
        // Build a label lookup for the static built-in roles
        const staticLabelMap = Object.fromEntries(agentRoles.map((r) => [r.value, r.label]));

        // Group agents by their assigned role value
        const agentsByRole = new Map<string, Agent[]>();
        for (const agent of agents) {
          if (!agent.role) continue;
          const bucket = agentsByRole.get(agent.role) ?? [];
          agentsByRole.set(agent.role, [...bucket, agent]);
        }

        // Index database roles by normalised name for matching
        const dbRoleByValue = new Map<string, Role>();
        for (const r of roles) {
          dbRoleByValue.set(r.name.toLowerCase(), r);
        }

        // Rows derived from agents: each unique role value they carry
        const agentRoleValues = [...agentsByRole.keys()];

        // Database-only roles (not used by any agent under any name variant)
        const dbOnlyRoles = roles.filter(
          (r) => !agentsByRole.has(r.name.toLowerCase()) && !agentsByRole.has(r.name)
        );

        const totalRows = agentRoleValues.length + dbOnlyRoles.length;

        return (
          <div className="roles-section">
            <div className="roles-section-header">
              <p className="roles-section-hint">
                Roles bundle skills together. When you create an agent with a matching role, its skills are offered for automatic installation.
              </p>
              <button className="button primary small" onClick={() => setRoleModal({ mode: 'new' })}>
                <Plus size={14} /> New role
              </button>
            </div>

            {totalRows === 0 ? (
              <div className="skills-empty">
                <Users size={28} />
                <p>No roles yet. Assign a role to an agent or create a role here to bundle skills together.</p>
                <div className="skills-empty-actions">
                  <button className="button primary" onClick={() => setRoleModal({ mode: 'new' })}>Create a role</button>
                </div>
              </div>
            ) : (
              <div className="role-cards-grid">
                {/* Rows for roles assigned to at least one agent */}
                {agentRoleValues.map((value) => {
                  const roleAgents = agentsByRole.get(value)!;
                  const dbRole = dbRoleByValue.get(value.toLowerCase());
                  const roleSkills = (dbRole?.skillIds ?? [])
                    .map((id) => skills.find((s) => s.id === id))
                    .filter(Boolean) as Skill[];
                  const label = staticLabelMap[value] ?? dbRole?.name ?? value;

                  return (
                    <div key={value} className="role-card">
                      <div className="role-card-header">
                        <div className="role-card-icon"><Users size={16} /></div>
                        <div className="role-card-title-wrap">
                          <h3 className="role-card-name">{label}</h3>
                          <p className="role-card-desc">
                            {roleAgents.length} agent{roleAgents.length > 1 ? 's' : ''}: {roleAgents.map((a) => a.name).join(', ')}
                          </p>
                        </div>
                        <div className="role-card-actions">
                          {dbRole ? (
                            <>
                              <button className="icon-button" title="Edit skills" onClick={() => setRoleModal({ mode: 'edit', role: dbRole })}>
                                <Pencil size={13} />
                              </button>
                              <button className="icon-button danger" title="Delete" onClick={() => void deleteRole(dbRole.id)}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="button secondary small"
                              title="Attach skills to this role"
                              onClick={() => setRoleModal({ mode: 'new', initialName: label })}
                            >
                              <Plus size={12} /> Skills
                            </button>
                          )}
                        </div>
                      </div>
                      {roleSkills.length > 0 ? (
                        <div className="role-skill-chips">
                          {roleSkills.map((s) => <span key={s.id} className="role-skill-chip">{s.name}</span>)}
                          {(dbRole?.skillIds.length ?? 0) > roleSkills.length && (
                            <span className="role-skill-chip missing">{(dbRole?.skillIds.length ?? 0) - roleSkills.length} removed</span>
                          )}
                        </div>
                      ) : (
                        <p className="role-no-skills">
                          {dbRole ? 'No skills attached. Edit to add skills.' : 'No skills configured — click "+ Skills" to add.'}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Database roles not used by any agent */}
                {dbOnlyRoles.map((dbRole) => {
                  const roleSkills = dbRole.skillIds
                    .map((id) => skills.find((s) => s.id === id))
                    .filter(Boolean) as Skill[];
                  return (
                    <div key={dbRole.id} className="role-card">
                      <div className="role-card-header">
                        <div className="role-card-icon"><Users size={16} /></div>
                        <div className="role-card-title-wrap">
                          <h3 className="role-card-name">{dbRole.name}</h3>
                          {dbRole.description
                            ? <p className="role-card-desc">{dbRole.description}</p>
                            : <p className="role-card-desc role-card-desc-muted">Not assigned to any agent</p>
                          }
                        </div>
                        <div className="role-card-actions">
                          <button className="icon-button" title="Edit" onClick={() => setRoleModal({ mode: 'edit', role: dbRole })}>
                            <Pencil size={13} />
                          </button>
                          <button className="icon-button danger" title="Delete" onClick={() => void deleteRole(dbRole.id)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {roleSkills.length > 0 ? (
                        <div className="role-skill-chips">
                          {roleSkills.map((s) => <span key={s.id} className="role-skill-chip">{s.name}</span>)}
                          {dbRole.skillIds.length > roleSkills.length && (
                            <span className="role-skill-chip missing">{dbRole.skillIds.length - roleSkills.length} removed</span>
                          )}
                        </div>
                      ) : (
                        <p className="role-no-skills">No skills attached. Edit to add skills.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {modal && (
        <SkillModal
          mode={modal.mode}
          skill={modal.skill}
          openaiConfigured={openaiConfigured}
          request={request}
          onSave={() => { setModal(null); showToast(modal.mode === 'edit' ? 'Skill updated.' : 'Skill created.'); }}
          onClose={() => setModal(null)}
        />
      )}

      {roleModal && (
        <RoleModal
          mode={roleModal.mode}
          role={roleModal.role}
          initialName={roleModal.initialName}
          skills={skills}
          request={request}
          onSave={() => { setRoleModal(null); showToast(roleModal.mode === 'edit' ? 'Role updated.' : 'Role created.'); }}
          onClose={() => setRoleModal(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
