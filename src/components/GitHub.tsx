import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Agent,
  GitHubIssue,
  GitHubProjectItem,
  GitHubProjectV2,
  GitHubRepo,
  GitHubSync,
  Runner,
  Task,
} from '../../shared/types';
import { type Request } from '../api';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed.');

type GHTab = 'setup' | 'browse' | 'syncs';

interface GitHubProps {
  request: Request;
  agents: Agent[];
  tasks: Task[];
  github: { configured: boolean };
  githubSyncs: GitHubSync[];
  vaultUnlocked: boolean;
  onVaultOpen: () => void;
  demo: boolean;
}

const REPO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default function GitHub({
  request,
  agents,
  tasks,
  github,
  githubSyncs,
  vaultUnlocked,
  onVaultOpen,
  demo,
}: GitHubProps) {
  const [tab, setTab] = useState<GHTab>('setup');

  // Repo cache lifted here so it survives tab switches
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const reposLastFetched = useRef<number>(0);
  const fetchingReposRef = useRef(false);

  // Projects cache (account-level, not per-repo)
  const [projects, setProjects] = useState<GitHubProjectV2[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const projectsLastFetched = useRef<number>(0);
  const fetchingProjectsRef = useRef(false);

  // Project items cache (keyed by project node ID)
  const [projectItems, setProjectItems] = useState<Record<string, GitHubProjectItem[]>>({});

  const fetchRepos = async (force = false) => {
    if (fetchingReposRef.current) return;
    if (!force && Date.now() - reposLastFetched.current < REPO_CACHE_TTL) return;
    fetchingReposRef.current = true;
    setReposLoading(true);
    setReposError('');
    try {
      const data = await request<GitHubRepo[]>('/github/repos');
      setRepos(data);
      reposLastFetched.current = Date.now();
    } catch (e) {
      setReposError(msg(e));
    } finally {
      setReposLoading(false);
      fetchingReposRef.current = false;
    }
  };

  const fetchProjects = async (force = false) => {
    if (fetchingProjectsRef.current) return;
    if (!force && Date.now() - projectsLastFetched.current < REPO_CACHE_TTL) return;
    fetchingProjectsRef.current = true;
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const data = await request<GitHubProjectV2[]>('/github/projects');
      setProjects(data.filter((p) => !p.closed));
      projectsLastFetched.current = Date.now();
    } catch (e) {
      setProjectsError(msg(e));
    } finally {
      setProjectsLoading(false);
      fetchingProjectsRef.current = false;
    }
  };

  // Initial load + periodic background refresh
  useEffect(() => {
    if (!github.configured || !vaultUnlocked) return;
    void fetchRepos();
    void fetchProjects();
    const timer = setInterval(() => { void fetchRepos(); void fetchProjects(); }, REPO_CACHE_TTL);
    return () => clearInterval(timer);
  }, [github.configured, vaultUnlocked]);

  useEffect(() => {
    if (github.configured && tab === 'setup') setTab('browse');
  }, [github.configured]);

  return (
    <div className="workspace-panel">
      <div className="panel-header">
        <h2>
          <Github size={20} />
          GitHub
        </h2>
      </div>
      <div className="gh-tabs">
        {(['setup', 'browse', 'syncs'] as GHTab[]).map((t) => (
          <button
            key={t}
            className={`gh-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'setup' ? 'Setup' : t === 'browse' ? 'Browse & Import' : 'Sync schedules'}
          </button>
        ))}
      </div>
      <div className="gh-body">
        {tab === 'setup' && (
          <SetupTab
            request={request}
            github={github}
            vaultUnlocked={vaultUnlocked}
            onVaultOpen={onVaultOpen}
            demo={demo}
          />
        )}
        {tab === 'browse' && (
          <BrowseTab
            request={request}
            agents={agents}
            tasks={tasks}
            github={github}
            vaultUnlocked={vaultUnlocked}
            onVaultOpen={onVaultOpen}
            demo={demo}
            repos={repos}
            reposLoading={reposLoading}
            reposError={reposError}
            onReposRefresh={() => void fetchRepos(true)}
            reposLastFetched={reposLastFetched.current}
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            onProjectsRefresh={() => void fetchProjects(true)}
            projectsLastFetched={projectsLastFetched.current}
            projectItems={projectItems}
            onProjectItems={(id, items) => setProjectItems((prev) => ({ ...prev, [id]: items }))}
          />
        )}
        {tab === 'syncs' && (
          <SyncsTab
            request={request}
            agents={agents}
            githubSyncs={githubSyncs}
            github={github}
            vaultUnlocked={vaultUnlocked}
            onVaultOpen={onVaultOpen}
            demo={demo}
          />
        )}
      </div>
    </div>
  );
}

function SetupTab({
  request,
  github,
  vaultUnlocked,
  onVaultOpen,
  demo,
}: {
  request: Request;
  github: { configured: boolean };
  vaultUnlocked: boolean;
  onVaultOpen: () => void;
  demo: boolean;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    if (!token.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request('/github/token', 'POST', { token: token.trim() });
      setToken('');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      await request('/github/token', 'DELETE');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!vaultUnlocked) {
    return (
      <div className="gh-setup-card">
        <p className="gh-setup-hint">
          GitHub tokens are stored encrypted in your vault. Unlock the vault first to connect your account.
        </p>
        <button className="button primary" onClick={onVaultOpen}>Unlock vault</button>
      </div>
    );
  }

  return (
    <div className="gh-setup-card">
      <h3>Connect GitHub</h3>
      {github.configured ? (
        <div className="gh-connected">
          <span className="gh-connected-badge">
            <Check size={14} /> Connected
          </span>
          <p className="gh-setup-hint">
            Your GitHub account is connected. You can browse repos and create sync schedules.
          </p>
          {error && <p className="form-error">{error}</p>}
          <button className="button secondary" disabled={busy || demo} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="gh-setup-hint">
            Enter a GitHub Personal Access Token (classic) with <code>repo</code> and <code>read:org</code> scopes.
            {' '}
            <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" className="gh-link">
              Create one on GitHub <ExternalLink size={12} />
            </a>
          </p>
          {error && <p className="form-error">{error}</p>}
          <div className="gh-token-row">
            <input
              type="password"
              className="field"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button primary" disabled={busy || !token.trim() || demo} onClick={connect}>
              {busy ? <Loader2 size={14} className="spin" /> : 'Connect'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BrowseTab({
  request,
  agents,
  tasks,
  github,
  vaultUnlocked,
  onVaultOpen,
  demo,
  repos,
  reposLoading,
  reposError,
  onReposRefresh,
  reposLastFetched,
  projects,
  projectsLoading,
  projectsError,
  onProjectsRefresh,
  projectsLastFetched,
  projectItems,
  onProjectItems,
}: {
  request: Request;
  agents: Agent[];
  tasks: Task[];
  github: { configured: boolean };
  vaultUnlocked: boolean;
  onVaultOpen: () => void;
  demo: boolean;
  repos: GitHubRepo[];
  reposLoading: boolean;
  reposError: string;
  onReposRefresh: () => void;
  reposLastFetched: number;
  projects: GitHubProjectV2[];
  projectsLoading: boolean;
  projectsError: string;
  onProjectsRefresh: () => void;
  projectsLastFetched: number;
  projectItems: Record<string, GitHubProjectItem[]>;
  onProjectItems: (id: string, items: GitHubProjectItem[]) => void;
}) {
  const [browseSubTab, setBrowseSubTab] = useState<'repos' | 'projects'>('repos');
  const [error, setError] = useState('');
  // Repo state
  const [repoSearch, setRepoSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoTab, setRepoTab] = useState<'issues' | 'prs'>('issues');
  const [items, setItems] = useState<GitHubIssue[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [loadingItems, setLoadingItems] = useState(false);
  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedProjectItems, setSelectedProjectItems] = useState<Map<string, GitHubProjectItem>>(new Map());
  const [importAgent, setImportAgent] = useState('');
  const [importRunner, setImportRunner] = useState<Runner>('hermes');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);

  const existingRefs = new Set(tasks.map((t) => t.githubRef).filter(Boolean));

  const orgs = useMemo(() => [...new Set(repos.map((r) => r.owner))].sort(), [repos]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.toLowerCase();
    return repos.filter(
      (r) =>
        (orgFilter === 'all' || r.owner === orgFilter) &&
        (!q || r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)),
    );
  }, [repos, repoSearch, orgFilter]);

  async function openRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setItems([]);
    setSelected(new Set());
    setImportResult(null);
    setItemSearch('');
    await loadRepoTab(repo, 'issues');
    setRepoTab('issues');
  }

  async function loadRepoTab(repo: GitHubRepo, t: 'issues' | 'prs') {
    setLoadingItems(true);
    setItems([]);
    try {
      const path = t === 'issues'
        ? `/github/repos/${repo.owner}/${repo.name}/issues`
        : `/github/repos/${repo.owner}/${repo.name}/pulls`;
      const data = await request<GitHubIssue[]>(path);
      setItems(data);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoadingItems(false);
    }
  }

  async function changeRepoTab(t: 'issues' | 'prs') {
    setRepoTab(t);
    setSelected(new Set());
    setItemSearch('');
    if (selectedRepo) await loadRepoTab(selectedRepo, t);
  }

  async function loadProjectItems(projectId: string) {
    if (projectItems[projectId]) return;
    try {
      const data = await request<GitHubProjectItem[]>(`/github/projects/${projectId}/items`);
      onProjectItems(projectId, data);
    } catch (e) {
      setError(msg(e));
    }
  }

  function toggleItem(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }

  function toggleProjectItem(item: GitHubProjectItem) {
    const key = item.url ?? item.id;
    setSelectedProjectItems((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key); else next.set(key, item);
      return next;
    });
  }

  async function importSelected() {
    if (!importAgent) return;
    const itemsToImport: Array<{ title: string; body?: string; url: string }> = [];
    if (browseSubTab === 'repos') {
      for (const url of selected) {
        const item = items.find((i) => i.url === url);
        if (item) itemsToImport.push({ title: item.title, body: item.body ?? undefined, url: item.url });
      }
    } else {
      for (const item of selectedProjectItems.values()) {
        itemsToImport.push({ title: item.title, body: item.body, url: item.url ?? item.id });
      }
    }
    if (!itemsToImport.length) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await request<{ created: number; skipped: number }>('/github/sync', 'POST', {
        items: itemsToImport,
        agentId: importAgent,
        runner: importRunner,
      });
      setImportResult(result);
      setSelected(new Set());
      setSelectedProjectItems(new Map());
    } catch (e) {
      setError(msg(e));
    } finally {
      setImporting(false);
    }
  }

  if (!vaultUnlocked) {
    return (
      <div className="gh-setup-card">
        <p className="gh-setup-hint">Unlock the vault to browse GitHub.</p>
        <button className="button primary" onClick={onVaultOpen}>Unlock vault</button>
      </div>
    );
  }
  if (!github.configured) {
    return (
      <div className="gh-setup-card">
        <p className="gh-setup-hint">Connect your GitHub account in the Setup tab first.</p>
      </div>
    );
  }

  const filteredItems = items.filter((i) => !itemSearch || i.title.toLowerCase().includes(itemSearch.toLowerCase()));
  const selCount = browseSubTab === 'repos' ? selected.size : selectedProjectItems.size;
  const activeError = error || reposError || projectsError;

  return (
    <div className="gh-browse-full">
      {activeError && (
        <div className="gh-error">
          <AlertCircle size={14} /> {activeError}
          <button onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}

      {/* Top-level sub-tabs: Repos | Projects */}
      <div className="gh-browse-subtabs">
        <button
          className={`gh-tab ${browseSubTab === 'repos' ? 'active' : ''}`}
          onClick={() => { setBrowseSubTab('repos'); setSelectedRepo(null); }}
        >
          Repositories
        </button>
        <button
          className={`gh-tab ${browseSubTab === 'projects' ? 'active' : ''}`}
          onClick={() => setBrowseSubTab('projects')}
        >
          Projects
        </button>
      </div>

      {/* ── REPOS SUB-TAB ── */}
      {browseSubTab === 'repos' && !selectedRepo && (() => {
        const age = reposLastFetched ? Math.floor((Date.now() - reposLastFetched) / 60000) : null;
        return (
          <>
            <div className="gh-repo-toolbar">
              <div className="gh-search-wrap">
                <Search size={14} className="gh-search-icon" />
                <input
                  className="field gh-search-input"
                  placeholder="Search repositories…"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                />
              </div>
              <select className="field gh-org-select" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="all">All owners</option>
                {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <span className="gh-repo-count-label">{filteredRepos.length} repo{filteredRepos.length !== 1 ? 's' : ''}</span>
              {age !== null && <span className="gh-cache-age">{age < 1 ? 'Just updated' : `Updated ${age}m ago`}</span>}
              <button className="button ghost gh-refresh-btn" onClick={onReposRefresh} disabled={reposLoading} title="Refresh repos">
                {reposLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              </button>
            </div>
            {filteredRepos.length === 0 && !reposLoading && (
              <div className="gh-empty-panel"><GitBranch size={28} /><p>No repositories match your filter.</p></div>
            )}
            <div className="gh-repo-grid">
              {filteredRepos.map((repo) => (
                <button key={repo.id} className="gh-repo-card" onClick={() => void openRepo(repo)}>
                  <div className="gh-repo-card-header">
                    <span className="gh-repo-card-owner">{repo.owner}</span>
                    {repo.private && <span className="gh-repo-private">private</span>}
                  </div>
                  <span className="gh-repo-card-name">{repo.name}</span>
                  {repo.description && <span className="gh-repo-card-desc">{repo.description}</span>}
                  <div className="gh-repo-card-footer">
                    {repo.language && <span className="gh-repo-lang">{repo.language}</span>}
                    {repo.openIssuesCount > 0 && (
                      <span className="gh-repo-issues">{repo.openIssuesCount} open</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* ── REPO DETAIL ── */}
      {browseSubTab === 'repos' && selectedRepo && (
        <>
          <div className="gh-detail-header">
            <button className="button ghost gh-back-btn" onClick={() => setSelectedRepo(null)}>
              <ArrowLeft size={14} /> All repos
            </button>
            <span className="gh-detail-title">
              <span className="gh-repo-card-owner">{selectedRepo.owner}</span>
              <span> / </span>
              <strong>{selectedRepo.name}</strong>
            </span>
            {selectedRepo.description && <span className="gh-detail-desc">{selectedRepo.description}</span>}
          </div>
          <div className="gh-detail-toolbar">
            <div className="gh-repo-tabs">
              {(['issues', 'prs'] as const).map((t) => (
                <button key={t} className={`gh-tab ${repoTab === t ? 'active' : ''}`} onClick={() => void changeRepoTab(t)}>
                  {t === 'prs' ? 'Pull Requests' : 'Issues'}
                </button>
              ))}
            </div>
            <div className="gh-search-wrap">
              <Search size={13} className="gh-search-icon" />
              <input
                className="field gh-search-input"
                placeholder="Filter…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="gh-item-panel-flat">
            {loadingItems ? (
              <div className="gh-loading"><Loader2 size={18} className="spin" /> Loading…</div>
            ) : (
              <div className="gh-issue-list">
                {filteredItems.length === 0 && (
                  <p className="gh-empty">No {repoTab === 'prs' ? 'pull requests' : 'issues'} {itemSearch ? 'match your filter' : 'found'}.</p>
                )}
                {filteredItems.map((item) => {
                  const imported = existingRefs.has(item.url);
                  return (
                    <label key={item.number} className={`gh-item ${imported ? 'imported' : ''}`}>
                      <input type="checkbox" disabled={imported} checked={selected.has(item.url)} onChange={() => toggleItem(item.url)} />
                      <span className="gh-item-number">#{item.number}</span>
                      <span className="gh-item-title">{item.title}</span>
                      {item.labels.map((l) => <span key={l} className="gh-label">{l}</span>)}
                      {imported && <span className="gh-imported-badge">Imported</span>}
                      <a href={item.url} target="_blank" rel="noreferrer" className="gh-item-link" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={11} />
                      </a>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── PROJECTS SUB-TAB ── */}
      {browseSubTab === 'projects' && (() => {
        const age = projectsLastFetched ? Math.floor((Date.now() - projectsLastFetched) / 60000) : null;
        return (
          <>
            <div className="gh-repo-toolbar">
              <span className="gh-repo-count-label">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
              {age !== null && <span className="gh-cache-age">{age < 1 ? 'Just updated' : `Updated ${age}m ago`}</span>}
              <button className="button ghost gh-refresh-btn" onClick={onProjectsRefresh} disabled={projectsLoading} title="Refresh projects">
                {projectsLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              </button>
            </div>
            <div className="gh-item-panel-flat">
              {projectsLoading && projects.length === 0 ? (
                <div className="gh-loading"><Loader2 size={18} className="spin" /> Loading projects…</div>
              ) : (
                <div className="gh-projects">
                  {projects.length === 0 && <div className="gh-empty-panel"><p>No open projects found.</p></div>}
                  {projects.map((project) => (
                    <details
                      key={project.id}
                      className="gh-project-group"
                      onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void loadProjectItems(project.id); }}
                    >
                      <summary className="gh-project-summary">
                        <ChevronRight size={14} className="gh-chevron" />
                        <span>{project.title}</span>
                        <span className="gh-project-owner">{project.owner}</span>
                      </summary>
                      {projectItems[project.id] ? (
                        <div className="gh-project-items">
                          {projectItems[project.id].map((item) => {
                            const key = item.url ?? item.id;
                            const imported = item.url ? existingRefs.has(item.url) : false;
                            return (
                              <label key={item.id} className={`gh-item ${imported ? 'imported' : ''}`}>
                                <input type="checkbox" disabled={imported} checked={selectedProjectItems.has(key)} onChange={() => toggleProjectItem(item)} />
                                <span className="gh-item-title">{item.title}</span>
                                {item.status && <span className="gh-item-status">{item.status}</span>}
                                {imported && <span className="gh-imported-badge">Imported</span>}
                              </label>
                            );
                          })}
                          {projectItems[project.id].length === 0 && <p className="gh-empty">No items.</p>}
                        </div>
                      ) : <p className="gh-empty">Expand to load items…</p>}
                    </details>
                  ))}
                </div>
              )}
            </div>
          </>
        );
      })()}

      {selCount > 0 && (
        <div className="gh-import-bar">
          <span>{selCount} selected</span>
          <select className="field" value={importAgent} onChange={(e) => setImportAgent(e.target.value)}>
            <option value="">— Assign to agent —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="field" value={importRunner} onChange={(e) => setImportRunner(e.target.value as Runner)}>
            <option value="hermes">Hermes</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="opencode">OpenCode</option>
          </select>
          <button className="button primary" disabled={importing || !importAgent || demo} onClick={() => void importSelected()}>
            {importing ? <Loader2 size={14} className="spin" /> : 'Create tasks'}
          </button>
          {importResult && (
            <span className="gh-import-result">
              {importResult.created > 0 && <><Check size={13} /> {importResult.created} created</>}
              {importResult.skipped > 0 && <>, {importResult.skipped} skipped</>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SyncsTab({
  request,
  agents,
  githubSyncs,
  github,
  vaultUnlocked,
  onVaultOpen,
  demo,
}: {
  request: Request;
  agents: Agent[];
  githubSyncs: GitHubSync[];
  github: { configured: boolean };
  vaultUnlocked: boolean;
  onVaultOpen: () => void;
  demo: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GitHubSync | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState<Set<string>>(new Set());

  async function deleteSync(id: string) {
    try {
      await request(`/github/syncs/${id}`, 'DELETE');
    } catch (e) {
      setError(msg(e));
    }
  }

  async function runNow(id: string) {
    setRunning((prev) => new Set(prev).add(id));
    setError('');
    try {
      const result = await request<{ created: number; skipped: number }>(`/github/syncs/${id}/run`, 'POST', {});
      setError('');
      void result;
    } catch (e) {
      setError(msg(e));
    } finally {
      setRunning((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function toggleEnabled(sync: GitHubSync) {
    try {
      await request(`/github/syncs/${sync.id}`, 'PATCH', { enabled: !sync.enabled });
    } catch (e) {
      setError(msg(e));
    }
  }

  if (!vaultUnlocked) {
    return (
      <div className="gh-setup-card">
        <p className="gh-setup-hint">Unlock the vault to manage GitHub syncs.</p>
        <button className="button primary" onClick={onVaultOpen}>Unlock vault</button>
      </div>
    );
  }

  if (!github.configured) {
    return (
      <div className="gh-setup-card">
        <p className="gh-setup-hint">Connect your GitHub account in the Setup tab first.</p>
      </div>
    );
  }

  return (
    <div className="gh-syncs">
      {error && (
        <div className="gh-error">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}
      <div className="gh-syncs-header">
        <p className="gh-setup-hint">Automatically sync GitHub issues, PRs, or project items as tasks on a schedule.</p>
        <button className="button primary" disabled={demo} onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={14} /> New sync
        </button>
      </div>

      {githubSyncs.length === 0 && !showForm && (
        <div className="gh-empty-panel">
          <RefreshCw size={28} />
          <p>No sync schedules yet. Create one to automatically import GitHub items as tasks.</p>
        </div>
      )}

      {githubSyncs.map((sync) => {
        const agent = agents.find((a) => a.id === sync.agentId);
        return (
          <div key={sync.id} className={`gh-sync-card ${sync.enabled ? '' : 'disabled'}`}>
            <div className="gh-sync-header">
              <strong>{sync.name}</strong>
              <span className={`gh-sync-type`}>{sync.type}</span>
              {sync.repoFullName && <span className="gh-sync-repo">{sync.repoFullName}</span>}
            </div>
            <div className="gh-sync-meta">
              <span>Agent: {agent?.name ?? 'Unknown'}</span>
              <span>Every {sync.intervalMinutes}m</span>
              {sync.lastSyncedAt && <span>Last: {new Date(sync.lastSyncedAt).toLocaleString()}</span>}
            </div>
            {sync.lastError && (
              <p className="gh-sync-error"><AlertCircle size={12} /> {sync.lastError}</p>
            )}
            <div className="gh-sync-actions">
              <button
                className={`button ${sync.enabled ? 'secondary' : 'primary'}`}
                disabled={demo}
                onClick={() => void toggleEnabled(sync)}
              >
                {sync.enabled ? 'Pause' : 'Enable'}
              </button>
              <button
                className="button secondary"
                disabled={running.has(sync.id) || demo}
                onClick={() => void runNow(sync.id)}
              >
                {running.has(sync.id) ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                Run now
              </button>
              <button
                className="button secondary"
                disabled={demo}
                onClick={() => { setEditing(sync); setShowForm(true); }}
              >
                Edit
              </button>
              <button
                className="button secondary danger"
                disabled={demo}
                onClick={() => void deleteSync(sync.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        );
      })}

      {showForm && (
        <SyncForm
          request={request}
          agents={agents}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function SyncForm({
  request,
  agents,
  existing,
  onClose,
  onError,
}: {
  request: Request;
  agents: Agent[];
  existing: GitHubSync | null;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<'issues' | 'prs' | 'project'>(existing?.type ?? 'issues');
  const [repoFullName, setRepoFullName] = useState(existing?.repoFullName ?? '');
  const [projectNodeId, setProjectNodeId] = useState(existing?.projectNodeId ?? '');
  const [agentId, setAgentId] = useState(existing?.agentId ?? '');
  const [runner, setRunner] = useState<Runner>(existing?.runner ?? 'hermes');
  const [intervalMinutes, setIntervalMinutes] = useState(existing?.intervalMinutes ?? 60);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>(existing?.stateFilter ?? 'open');
  const [labelFilter, setLabelFilter] = useState(existing?.labelFilter?.join(', ') ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !agentId) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      type,
      agentId,
      runner,
      enabled,
      intervalMinutes,
      stateFilter: type !== 'project' ? stateFilter : undefined,
      labelFilter: type === 'issues' && labelFilter.trim() ? labelFilter.split(',').map((l) => l.trim()).filter(Boolean) : undefined,
      repoFullName: type !== 'project' ? repoFullName.trim() || undefined : undefined,
      projectNodeId: type === 'project' ? projectNodeId.trim() || undefined : undefined,
    };
    try {
      if (existing) {
        await request(`/github/syncs/${existing.id}`, 'PATCH', body);
      } else {
        await request('/github/syncs', 'POST', body);
      }
      onClose();
    } catch (e) {
      onError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gh-sync-form">
      <h4>{existing ? 'Edit sync' : 'New GitHub sync'}</h4>
      <div className="form-row">
        <label className="form-label">Name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="My sync" />
      </div>
      <div className="form-row">
        <label className="form-label">Type</label>
        <select className="field" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="issues">Issues</option>
          <option value="prs">Pull Requests</option>
          <option value="project">Project (v2)</option>
        </select>
      </div>
      {type !== 'project' && (
        <div className="form-row">
          <label className="form-label">Repository</label>
          <input className="field" value={repoFullName} onChange={(e) => setRepoFullName(e.target.value)} placeholder="owner/repo" />
        </div>
      )}
      {type === 'project' && (
        <div className="form-row">
          <label className="form-label">Project node ID</label>
          <input className="field" value={projectNodeId} onChange={(e) => setProjectNodeId(e.target.value)} placeholder="PVT_..." />
        </div>
      )}
      {type !== 'project' && (
        <div className="form-row">
          <label className="form-label">State filter</label>
          <select className="field" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </div>
      )}
      {type === 'issues' && (
        <div className="form-row">
          <label className="form-label">Label filter</label>
          <input className="field" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} placeholder="bug, enhancement (comma separated)" />
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Agent</label>
        <select className="field" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">— Select agent —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Runner</label>
        <select className="field" value={runner} onChange={(e) => setRunner(e.target.value as Runner)}>
          <option value="hermes">Hermes</option>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Interval (minutes)</label>
        <input className="field" type="number" min={1} max={10080} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} />
      </div>
      <div className="form-row form-row-check">
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>
      <div className="form-footer">
        <button className="button secondary" onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={busy || !name.trim() || !agentId} onClick={() => void submit()}>
          {busy ? <Loader2 size={14} className="spin" /> : existing ? 'Save changes' : 'Create sync'}
        </button>
      </div>
    </div>
  );
}
