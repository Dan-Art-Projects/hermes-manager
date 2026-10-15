import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Github,
  Loader2,
  Plus,
  RefreshCw,
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
}: {
  request: Request;
  agents: Agent[];
  tasks: Task[];
  github: { configured: boolean };
  vaultUnlocked: boolean;
  onVaultOpen: () => void;
  demo: boolean;
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoTab, setRepoTab] = useState<'issues' | 'prs' | 'projects'>('issues');
  const [items, setItems] = useState<GitHubIssue[]>([]);
  const [projects, setProjects] = useState<GitHubProjectV2[]>([]);
  const [projectItems, setProjectItems] = useState<Record<string, GitHubProjectItem[]>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedProjectItems, setSelectedProjectItems] = useState<Map<string, GitHubProjectItem>>(new Map());
  const [importAgent, setImportAgent] = useState('');
  const [importRunner, setImportRunner] = useState<Runner>('hermes');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);

  const existingRefs = new Set(tasks.map((t) => t.githubRef).filter(Boolean));

  useEffect(() => {
    if (!github.configured || !vaultUnlocked) return;
    setLoading(true);
    setError('');
    request<GitHubRepo[]>('/github/repos')
      .then((data) => setRepos(data))
      .catch((e) => setError(msg(e)))
      .finally(() => setLoading(false));
  }, [github.configured, vaultUnlocked]);

  async function selectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setItems([]);
    setProjects([]);
    setSelected(new Set());
    setSelectedProjectItems(new Map());
    setImportResult(null);
    setLoadingItems(true);
    try {
      if (repoTab === 'issues') {
        const data = await request<GitHubIssue[]>(`/github/repos/${repo.owner}/${repo.name}/issues`);
        setItems(data);
      } else if (repoTab === 'prs') {
        const data = await request<GitHubIssue[]>(`/github/repos/${repo.owner}/${repo.name}/pulls`);
        setItems(data);
      } else {
        const data = await request<GitHubProjectV2[]>('/github/projects');
        setProjects(data.filter((p) => !p.closed));
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoadingItems(false);
    }
  }

  async function changeRepoTab(t: 'issues' | 'prs' | 'projects') {
    setRepoTab(t);
    setItems([]);
    setProjects([]);
    setSelected(new Set());
    setSelectedProjectItems(new Map());
    if (!selectedRepo) return;
    setLoadingItems(true);
    try {
      if (t === 'issues') {
        const data = await request<GitHubIssue[]>(`/github/repos/${selectedRepo.owner}/${selectedRepo.name}/issues`);
        setItems(data);
      } else if (t === 'prs') {
        const data = await request<GitHubIssue[]>(`/github/repos/${selectedRepo.owner}/${selectedRepo.name}/pulls`);
        setItems(data);
      } else {
        const data = await request<GitHubProjectV2[]>('/github/projects');
        setProjects(data.filter((p) => !p.closed));
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadProjectItems(projectId: string) {
    if (projectItems[projectId]) return;
    try {
      const data = await request<GitHubProjectItem[]>(`/github/projects/${projectId}/items`);
      setProjectItems((prev) => ({ ...prev, [projectId]: data }));
    } catch (e) {
      setError(msg(e));
    }
  }

  function toggleItem(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleProjectItem(item: GitHubProjectItem) {
    const key = item.url ?? item.id;
    setSelectedProjectItems((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  }

  async function importSelected() {
    if (!importAgent) return;
    const itemsToImport: Array<{ title: string; body?: string; url: string }> = [];
    if (repoTab !== 'projects') {
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

  const selCount = repoTab !== 'projects' ? selected.size : selectedProjectItems.size;

  return (
    <div className="gh-browse">
      {error && (
        <div className="gh-error">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}
      <div className="gh-browse-layout">
        <div className="gh-repo-list">
          <div className="gh-repo-list-header">
            <span>Repositories</span>
            {loading && <Loader2 size={14} className="spin" />}
          </div>
          {repos.map((repo) => (
            <button
              key={repo.id}
              className={`gh-repo-item ${selectedRepo?.id === repo.id ? 'active' : ''}`}
              onClick={() => void selectRepo(repo)}
            >
              <span className="gh-repo-name">{repo.name}</span>
              <span className="gh-repo-owner">{repo.owner}</span>
              {repo.openIssuesCount > 0 && <span className="gh-repo-count">{repo.openIssuesCount}</span>}
            </button>
          ))}
          {!loading && repos.length === 0 && <p className="gh-empty">No repositories found.</p>}
        </div>

        <div className="gh-item-panel">
          {!selectedRepo ? (
            <div className="gh-empty-panel">
              <GitBranch size={32} />
              <p>Select a repository to browse its issues, pull requests, and projects.</p>
            </div>
          ) : (
            <>
              <div className="gh-repo-tabs">
                {(['issues', 'prs', 'projects'] as const).map((t) => (
                  <button
                    key={t}
                    className={`gh-tab ${repoTab === t ? 'active' : ''}`}
                    onClick={() => void changeRepoTab(t)}
                  >
                    {t === 'prs' ? 'Pull Requests' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {loadingItems ? (
                <div className="gh-loading"><Loader2 size={18} className="spin" /> Loading...</div>
              ) : repoTab === 'projects' ? (
                <div className="gh-projects">
                  {projects.length === 0 && <p className="gh-empty">No open projects found for your account.</p>}
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
                                <input
                                  type="checkbox"
                                  disabled={imported}
                                  checked={selectedProjectItems.has(key)}
                                  onChange={() => toggleProjectItem(item)}
                                />
                                <span className="gh-item-title">{item.title}</span>
                                {item.status && <span className="gh-item-status">{item.status}</span>}
                                {imported && <span className="gh-imported-badge">Imported</span>}
                              </label>
                            );
                          })}
                          {projectItems[project.id].length === 0 && (
                            <p className="gh-empty">No items in this project.</p>
                          )}
                        </div>
                      ) : (
                        <p className="gh-empty">Loading items...</p>
                      )}
                    </details>
                  ))}
                </div>
              ) : (
                <div className="gh-issue-list">
                  {items.length === 0 && <p className="gh-empty">No open {repoTab === 'prs' ? 'pull requests' : 'issues'} found.</p>}
                  {items.map((item) => {
                    const imported = existingRefs.has(item.url);
                    return (
                      <label key={item.number} className={`gh-item ${imported ? 'imported' : ''}`}>
                        <input
                          type="checkbox"
                          disabled={imported}
                          checked={selected.has(item.url)}
                          onChange={() => toggleItem(item.url)}
                        />
                        <span className="gh-item-number">#{item.number}</span>
                        <span className="gh-item-title">{item.title}</span>
                        {item.labels.map((l) => (
                          <span key={l} className="gh-label">{l}</span>
                        ))}
                        {imported && <span className="gh-imported-badge">Imported</span>}
                        <a href={item.url} target="_blank" rel="noreferrer" className="gh-item-link" onClick={(e) => e.stopPropagation()}>
                          <ExternalLink size={11} />
                        </a>
                      </label>
                    );
                  })}
                </div>
              )}

              {selCount > 0 && (
                <div className="gh-import-bar">
                  <span>{selCount} selected</span>
                  <select
                    className="field"
                    value={importAgent}
                    onChange={(e) => setImportAgent(e.target.value)}
                  >
                    <option value="">— Assign to agent —</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <select
                    className="field"
                    value={importRunner}
                    onChange={(e) => setImportRunner(e.target.value as Runner)}
                  >
                    <option value="hermes">Hermes</option>
                    <option value="claude">Claude Code</option>
                    <option value="codex">Codex</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                  <button
                    className="button primary"
                    disabled={importing || !importAgent || demo}
                    onClick={() => void importSelected()}
                  >
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
            </>
          )}
        </div>
      </div>
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
