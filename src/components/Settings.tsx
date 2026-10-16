import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  X,
} from 'lucide-react';
import {
  agentRoles,
  codingTools,
  runnerNames,
  type Agent,
  type AgentSkill,
  type AppSnapshot,
  type CatalogModel,
  type ModelDefaults,
  type SshKey,
} from '../../shared/types';
import { curatedSkills, makeCuratedSkillMd } from '../skills';
import { type Request } from '../api';
import { Models } from './Workspace';

export type Theme = 'jade' | 'sky' | 'violet' | 'amber' | 'rose' | 'teal';
export const themes: { id: Theme; label: string; color: string }[] = [
  { id: 'jade',   label: 'Jade',   color: '#3ecf8e' },
  { id: 'sky',    label: 'Sky',    color: '#5cc8ff' },
  { id: 'violet', label: 'Violet', color: '#a98bff' },
  { id: 'amber',  label: 'Amber',  color: '#ffb547' },
  { id: 'rose',   label: 'Rose',   color: '#ff6f91' },
  { id: 'teal',   label: 'Teal',   color: '#2fd6c6' },
];

type SettingsTab = 'general' | 'vault' | 'ssh-keys' | 'api-keys' | 'models' | 'skills';
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed.');

export default function Settings({
  request,
  state,
  agents,
  sshKeys,
  defaults,
  name,
  theme,
  onName,
  onTheme,
  onVaultChange,
}: {
  request: Request;
  state: AppSnapshot;
  agents: Agent[];
  sshKeys: SshKey[];
  defaults: ModelDefaults;
  name: string;
  theme: Theme;
  onName: (name: string) => void;
  onTheme: (theme: Theme) => void;
  onVaultChange: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general',  label: 'General' },
    { id: 'vault',    label: 'Vault' },
    { id: 'ssh-keys', label: 'SSH Keys' },
    { id: 'api-keys', label: 'API Keys' },
    { id: 'models',   label: 'Models' },
    { id: 'skills',   label: 'Skills' },
  ];

  return (
    <div className="workspace-panel settings-panel">
      <div className="panel-header">
        <h2><Settings2 size={20} /> Settings</h2>
      </div>
      <div className="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 'general'  && <GeneralTab name={name} theme={theme} onName={onName} onTheme={onTheme} />}
        {tab === 'vault'    && <VaultTab state={state} request={request} onVaultChange={onVaultChange} />}
        {tab === 'ssh-keys' && <SshKeysTab sshKeys={sshKeys} request={request} />}
        {tab === 'api-keys' && <ApiKeysTab request={request} state={state} />}
        {tab === 'models'   && <Models request={request} agents={agents} defaults={defaults} />}
        {tab === 'skills'   && <SkillsTab request={request} agents={agents} />}
      </div>
    </div>
  );
}

/* ── General ─────────────────────────────────────────────────────────────── */

function GeneralTab({
  name,
  theme,
  onName,
  onTheme,
}: {
  name: string;
  theme: Theme;
  onName: (name: string) => void;
  onTheme: (theme: Theme) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(false);

  function save(e: FormEvent) {
    e.preventDefault();
    onName(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-section">
      <form className="settings-card" onSubmit={save}>
        <h3>Your name</h3>
        <p className="settings-hint">Shown in the workspace header. Stored in this browser only.</p>
        <div className="settings-row">
          <input
            className="field"
            maxLength={64}
            placeholder="e.g. Dann"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="button primary" disabled={saved}>
            {saved ? <><Check size={14} /> Saved</> : 'Save'}
          </button>
        </div>
      </form>

      <div className="settings-card">
        <h3>Accent colour</h3>
        <p className="settings-hint">Changes the highlight colour across the whole workspace.</p>
        <div className="theme-swatches">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`theme-swatch ${theme === t.id ? 'active' : ''}`}
              style={{ '--swatch': t.color } as React.CSSProperties}
              onClick={() => onTheme(t.id)}
              title={t.label}
              aria-pressed={theme === t.id}
            >
              {theme === t.id && <Check size={14} />}
            </button>
          ))}
        </div>
        <p className="settings-hint theme-labels">
          {themes.map((t) => (
            <span key={t.id} className={theme === t.id ? 'active-label' : ''}>{t.label}</span>
          ))}
        </p>
      </div>
    </div>
  );
}

/* ── Vault ───────────────────────────────────────────────────────────────── */

function VaultTab({
  state,
  request,
  onVaultChange,
}: {
  state: AppSnapshot;
  request: Request;
  onVaultChange: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = !state.vault.configured;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (setup && confirmation !== passphrase) { setError('The passphrases do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await request('/vault/unlock', 'POST', { passphrase });
      setPassphrase('');
      setConfirmation('');
      onVaultChange();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    try {
      await request('/vault/lock', 'POST');
      onVaultChange();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-card">
        <h3>Credential vault</h3>
        <p className="settings-hint">
          AES-256-GCM encrypted local storage for SSH credentials and API tokens.
          The passphrase never leaves this machine. There is no recovery option.
        </p>

        <div className={`vault-status-row ${state.vault.unlocked ? 'unlocked' : 'locked'}`}>
          {state.vault.unlocked ? <UnlockKeyhole size={18} /> : <LockKeyhole size={18} />}
          <span>
            {state.vault.unlocked ? 'Vault is unlocked' : state.vault.configured ? 'Vault is locked' : 'Vault not set up'}
          </span>
        </div>

        {state.vault.unlocked ? (
          <div className="settings-row">
            <p className="settings-hint">Agents can run. Lock the vault when you step away.</p>
            <button className="button secondary" disabled={busy} onClick={() => void lock()}>
              <LockKeyhole size={14} /> Lock vault
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="vault-inline-form">
            <label className="form-label">{setup ? 'Create passphrase' : 'Passphrase'}</label>
            <input
              type="password"
              className="field"
              minLength={12}
              maxLength={1024}
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete={setup ? 'new-password' : 'current-password'}
              placeholder="At least 12 characters"
            />
            {setup && (
              <>
                <label className="form-label">Confirm passphrase</label>
                <input
                  type="password"
                  className="field"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Enter your passphrase again"
                />
              </>
            )}
            {error && <p className="form-error">{error}</p>}
            <button className="button primary" disabled={busy}>
              {busy ? 'Unlocking...' : setup ? 'Create vault' : 'Unlock vault'}
              <ArrowRight size={15} />
            </button>
          </form>
        )}

        <div className="callout" style={{ marginTop: 16 }}>
          <ShieldCheck size={18} />
          <p>
            SSH credentials, API tokens, and GitHub PATs are encrypted.
            Task descriptions, reports, and logs are stored in plain text.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── SSH Keys ─────────────────────────────────────────────────────────────── */

function SshKeysTab({ sshKeys, request }: { sshKeys: SshKey[]; request: Request }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  async function addKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('add');
    setError('');
    const data = new FormData(e.currentTarget);
    const passphrase = String(data.get('passphrase') ?? '').trim();
    try {
      await request('/ssh-keys', 'POST', {
        name: String(data.get('name') ?? '').trim(),
        privateKey: String(data.get('privateKey') ?? ''),
        ...(passphrase ? { passphrase } : {}),
      });
      formRef.current?.reset();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy('');
    }
  }

  async function deleteKey(key: SshKey) {
    if (!confirm(`Remove "${key.name}"? Agents already using a copy of this key are not affected.`)) return;
    setBusy(key.id);
    setError('');
    try {
      await request(`/ssh-keys/${key.id}`, 'DELETE');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-card">
        <h3>Saved SSH keys</h3>
        <p className="settings-hint">Save a private key once and reuse it across multiple agents. Stored encrypted in the vault.</p>
        {error && <p className="form-error">{error}</p>}
        {sshKeys.length > 0 && (
          <ul className="key-list">
            {sshKeys.map((key) => (
              <li key={key.id} className="key-list-item">
                <KeyRound size={14} />
                <span>{key.name}</span>
                <small className="muted">{new Date(key.createdAt).toLocaleDateString()}</small>
                <button
                  className="button danger-text small"
                  disabled={!!busy}
                  onClick={() => void deleteKey(key)}
                >
                  {busy === key.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!sshKeys.length && <p className="settings-hint">No saved keys yet.</p>}
      </div>

      <div className="settings-card">
        <h3>Add SSH key</h3>
        <form ref={formRef} onSubmit={(e) => void addKey(e)} className="vault-inline-form">
          <label className="form-label">Key name</label>
          <input className="field" name="name" required maxLength={100} placeholder="e.g. My server key" />
          <label className="form-label">Private key</label>
          <textarea
            className="field mono"
            name="privateKey"
            rows={5}
            required
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            autoComplete="off"
            spellCheck={false}
          />
          <label className="form-label">Passphrase (if any)</label>
          <input className="field" name="passphrase" type="password" autoComplete="off" placeholder="Leave blank if none" />
          <button className="button primary" disabled={!!busy}>
            {busy === 'add' ? <Loader2 size={14} className="spin" /> : 'Save key'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── API Keys ─────────────────────────────────────────────────────────────── */

function ApiKeysTab({ request, state }: { request: Request; state: AppSnapshot }) {
  return (
    <div className="settings-section">
      <NousKeyCard request={request} />
      <GitHubKeyCard request={request} state={state} />
      <OpenAIKeyCard request={request} />
      <HuggingFaceKeyCard request={request} />
    </div>
  );
}

function NousKeyCard({ request }: { request: Request }) {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    request<{ configured: boolean; fetchedAt: string | null }>('/nous')
      .then((r) => { setConfigured(r.configured); setFetchedAt(r.fetchedAt); })
      .catch(() => {});
  }, []);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await request<{ count: number; fetchedAt: string }>('/nous', 'PUT', { key: key.trim() });
      setConfigured(true);
      setFetchedAt(result.fetchedAt);
      setStatus(`Catalog loaded — ${result.count} models available.`);
      setKey('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await request('/nous', 'DELETE');
      setConfigured(false);
      setFetchedAt(null);
      setStatus('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card">
      <h3>Nous Research API key</h3>
      <p className="settings-hint">
        Used to load the live model catalog in the Models tab.
        The key only reads models — agents use their own Nous sign-in.{' '}
        <a href="https://portal.nousresearch.com" target="_blank" rel="noreferrer" className="gh-link">
          Nous Portal <ExternalLink size={11} />
        </a>
      </p>
      {error && <p className="form-error">{error}</p>}
      {status && <p className="settings-status">{status}</p>}
      {configured && (
        <div className="api-key-status">
          <span className="gh-connected-badge"><Check size={13} /> Connected</span>
          {fetchedAt && <small className="muted">Catalog loaded {new Date(fetchedAt).toLocaleString()}</small>}
        </div>
      )}
      <div className="settings-row">
        <input
          type="password"
          className="field"
          placeholder={configured ? 'Replace existing key…' : 'Paste your Nous API key'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          autoComplete="off"
        />
        <button className="button primary" disabled={busy || !key.trim()} onClick={() => void save()}>
          {busy ? <Loader2 size={14} className="spin" /> : configured ? 'Replace' : 'Save key'}
        </button>
        {configured && (
          <button className="button secondary" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function OpenAIKeyCard({ request }: { request: Request }) {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request<{ configured: boolean }>('/openai/key')
      .then((r) => setConfigured(r.configured))
      .catch(() => {});
  }, []);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request('/openai/key', 'PUT', { key: key.trim() });
      setConfigured(true);
      setKey('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await request('/openai/key', 'DELETE');
      setConfigured(false);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card">
      <h3>OpenAI API key</h3>
      <p className="settings-hint">
        Used to auto-generate agent instructions. Model: <code>gpt-4o-mini</code>.
      </p>
      {error && <p className="form-error">{error}</p>}
      {configured && (
        <div className="api-key-status">
          <span className="gh-connected-badge"><Check size={13} /> Ready — gpt-4o-mini available</span>
        </div>
      )}
      <div className="settings-row">
        <input
          type="password"
          className="field"
          placeholder={configured ? 'Replace existing key…' : 'sk-…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          autoComplete="off"
        />
        <button className="button primary" disabled={busy || !key.trim()} onClick={() => void save()}>
          {busy ? <Loader2 size={14} className="spin" /> : configured ? 'Replace' : 'Save key'}
        </button>
        {configured && (
          <button className="button secondary" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function HuggingFaceKeyCard({ request }: { request: Request }) {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request<{ configured: boolean }>('/huggingface/key')
      .then((r) => setConfigured(r.configured))
      .catch(() => {});
  }, []);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request('/huggingface/key', 'PUT', { key: key.trim() });
      setConfigured(true);
      setKey('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await request('/huggingface/key', 'DELETE');
      setConfigured(false);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card">
      <h3>HuggingFace API key</h3>
      <p className="settings-hint">
        Used for HuggingFace Inference API. Set <code>provider: huggingface</code> on an agent to use it.
      </p>
      {error && <p className="form-error">{error}</p>}
      {configured && (
        <div className="api-key-status">
          <span className="gh-connected-badge"><Check size={13} /> Ready — Inference API available</span>
        </div>
      )}
      <div className="settings-row">
        <input
          type="password"
          className="field"
          placeholder={configured ? 'Replace existing key…' : 'hf_…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          autoComplete="off"
        />
        <button className="button primary" disabled={busy || !key.trim()} onClick={() => void save()}>
          {busy ? <Loader2 size={14} className="spin" /> : configured ? 'Replace' : 'Save key'}
        </button>
        {configured && (
          <button className="button secondary" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function GitHubKeyCard({ request, state }: { request: Request; state: AppSnapshot }) {
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
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      await request('/github/token', 'DELETE');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state.vault.unlocked) {
    return (
      <div className="settings-card">
        <h3><Github size={16} /> GitHub</h3>
        <p className="settings-hint">Unlock the vault to manage your GitHub token.</p>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <h3><Github size={16} /> GitHub</h3>
      <p className="settings-hint">
        Personal Access Token (classic) with <code>repo</code> and <code>read:org</code> scopes.{' '}
        <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" className="gh-link">
          Create on GitHub <ExternalLink size={11} />
        </a>
      </p>
      {error && <p className="form-error">{error}</p>}
      {state.github.configured && (
        <div className="api-key-status">
          <span className="gh-connected-badge"><Check size={13} /> Connected</span>
        </div>
      )}
      <div className="settings-row">
        <input
          type="password"
          className="field"
          placeholder={state.github.configured ? 'Replace existing token…' : 'ghp_…'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="button primary" disabled={busy || !token.trim()} onClick={() => void connect()}>
          {busy ? <Loader2 size={14} className="spin" /> : state.github.configured ? 'Replace' : 'Connect'}
        </button>
        {state.github.configured && (
          <button className="button secondary" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Skills ──────────────────────────────────────────────────────────────── */

function SkillsTab({ request, agents }: { request: Request; agents: Agent[] }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [installAgent, setInstallAgent] = useState('');
  const [installTab, setInstallTab] = useState<'browse' | 'url'>('browse');
  const [skillUrl, setSkillUrl] = useState('');
  const [agentSkills, setAgentSkills] = useState<Record<string, AgentSkill[]>>(() =>
    Object.fromEntries(agents.map((a) => [a.id, a.skills ?? []])),
  );

  const allSkills: { agent: Agent; skill: AgentSkill }[] = agents.flatMap((agent) =>
    (agentSkills[agent.id] ?? agent.skills ?? []).map((skill) => ({ agent, skill })),
  );

  async function removeSkill(agentId: string, skillId: string) {
    setBusy(skillId);
    setError('');
    try {
      await request(`/agents/${agentId}/skills/${skillId}`, 'DELETE');
      setAgentSkills((prev) => ({ ...prev, [agentId]: (prev[agentId] ?? []).filter((s) => s.id !== skillId) }));
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy('');
    }
  }

  async function installFromUrl() {
    if (!installAgent || !skillUrl.trim()) return;
    setBusy('url');
    setError('');
    try {
      const skill = await request<AgentSkill>(`/agents/${installAgent}/skills/fetch`, 'POST', { url: skillUrl.trim() });
      setAgentSkills((prev) => ({ ...prev, [installAgent]: [...(prev[installAgent] ?? []), skill] }));
      setSkillUrl('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy('');
    }
  }

  async function installCurated(slug: string) {
    if (!installAgent) return;
    const curated = curatedSkills.find((s) => s.slug === slug);
    if (!curated) return;
    setBusy(slug);
    setError('');
    try {
      const content = makeCuratedSkillMd(curated);
      const skill = await request<AgentSkill>(`/agents/${installAgent}/skills`, 'POST', { content, source: `curated:${slug}` });
      setAgentSkills((prev) => ({ ...prev, [installAgent]: [...(prev[installAgent] ?? []), skill] }));
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy('');
    }
  }

  const agentInstalledSkills = installAgent ? (agentSkills[installAgent] ?? agents.find((a) => a.id === installAgent)?.skills ?? []) : [];

  return (
    <div className="settings-section">
      {/* Installed skills across all agents */}
      <div className="settings-card">
        <h3><BookOpen size={15} /> Installed skills</h3>
        <p className="settings-hint">All skills installed across your agents. Each skill is injected as context when the agent runs a task.</p>
        {error && <p className="form-error">{error}</p>}
        {allSkills.length === 0 && <p className="settings-hint">No skills installed yet. Use the panel below to add some.</p>}
        {allSkills.length > 0 && (
          <div className="skills-global-list">
            {allSkills.map(({ agent, skill }) => (
              <div key={skill.id} className="skills-global-row">
                <div className="skills-global-meta">
                  <span className="skills-global-name">{skill.name}</span>
                  <span className="skills-global-agent">{agent.name}</span>
                </div>
                <p className="skills-global-desc">{skill.description}</p>
                <button
                  className="button danger-text small"
                  disabled={!!busy}
                  onClick={() => void removeSkill(agent.id, skill.id)}
                  title={`Remove ${skill.name} from ${agent.name}`}
                >
                  {busy === skill.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Install new skill */}
      <div className="settings-card">
        <h3>Install a skill</h3>
        <p className="settings-hint">Choose an agent, then pick a skill from the curated list or paste a SKILL.md URL.</p>
        <label className="form-label">Install on agent</label>
        <select
          className="field"
          value={installAgent}
          onChange={(e) => setInstallAgent(e.target.value)}
        >
          <option value="">— select an agent —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ''}</option>
          ))}
        </select>

        {installAgent && (
          <>
            <div className="skills-tabs" style={{ marginTop: 12 }}>
              <button type="button" className={installTab === 'browse' ? 'active' : ''} onClick={() => setInstallTab('browse')}>Browse</button>
              <button type="button" className={installTab === 'url' ? 'active' : ''} onClick={() => setInstallTab('url')}>From URL</button>
            </div>
            {installTab === 'browse' && (
              <div className="curated-skills" style={{ marginTop: 8 }}>
                {curatedSkills.map((cs) => {
                  const installed = agentInstalledSkills.some((s) => s.source === `curated:${cs.slug}`);
                  return (
                    <div key={cs.slug} className={`curated-skill-card ${installed ? 'installed' : ''}`}>
                      <div>
                        <strong>{cs.name}</strong>
                        <span className="skill-category">{cs.category}</span>
                      </div>
                      <p>{cs.description}</p>
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={installed || !!busy}
                        onClick={() => void installCurated(cs.slug)}
                      >
                        {busy === cs.slug ? <Loader2 size={11} className="spin" /> : <Plus size={11} />}
                        {installed ? 'Installed' : 'Install'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {installTab === 'url' && (
              <div className="skill-url-form" style={{ marginTop: 8 }}>
                <input
                  type="url"
                  className="field"
                  placeholder="https://raw.githubusercontent.com/…/SKILL.md"
                  value={skillUrl}
                  onChange={(e) => setSkillUrl(e.target.value)}
                  maxLength={2048}
                />
                <button
                  type="button"
                  className="button primary small"
                  disabled={!skillUrl.trim() || !!busy}
                  onClick={() => void installFromUrl()}
                >
                  {busy === 'url' ? <Loader2 size={13} className="spin" /> : 'Install'}
                </button>
                <span className="settings-hint">Paste a raw URL to any SKILL.md file.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
