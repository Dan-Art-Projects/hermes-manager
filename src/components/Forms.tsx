import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  agentColors,
  agentRoles,
  codingTools,
  runnerNames,
  type Agent,
  type AgentColor,
  type AgentInput,
  type AgentSkill,
  type AppSnapshot,
  type Role,
  type Runner,
  type Skill,
  type SshKey,
  type Task,
  type TaskStatus,
} from '../../shared/types';
import { agentStyle, statusNames, statuses, type Request } from '../api';
import { curatedSkills, makeCuratedSkillMd } from '../skills';
import Modal from './Modal';

export function VaultModal({
  state,
  request,
  onClose,
  onSuccess,
}: {
  state: AppSnapshot;
  request: Request;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = !state.vault.configured;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (setup && confirmation !== passphrase) {
      setError('The passphrases do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/vault/unlock', 'POST', { passphrase });
      setPassphrase('');
      setConfirmation('');
      onSuccess();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={setup ? 'A safe home for your credentials' : 'Unlock your credential vault'}
      subtitle={setup ? 'Set up your local, encrypted SSH vault.' : 'Your passphrase stays on this machine.'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-body">
        <div className="vault-art">
          <LockKeyhole size={32} />
          <span>AES-256-GCM encrypted</span>
          <small>Local storage. No cloud account.</small>
        </div>
        <label>
          Vault passphrase
          <input
            autoFocus
            type="password"
            minLength={12}
            maxLength={1024}
            required
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete={setup ? 'new-password' : 'current-password'}
            placeholder="At least 12 characters"
          />
        </label>
        {setup && (
          <label>
            Confirm passphrase
            <input
              type="password"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              placeholder="Enter your passphrase again"
            />
          </label>
        )}
        <div className="callout">
          <ShieldCheck size={18} />
          <p>
            {setup
              ? 'Keep this passphrase somewhere safe. There is no recovery option. SSH secrets are encrypted; task descriptions, reports, and logs are not.'
              : 'Unlocking enables SSH connections. Lock the vault when you are finished; it locks automatically when the manager stops.'}
          </p>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Unlocking...' : setup ? 'Create vault' : 'Unlock vault'}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function SshKeyModal({
  sshKeys,
  request,
  onClose,
}: {
  sshKeys: SshKey[];
  request: Request;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function addKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('add');
    setError('');
    const form = new FormData(event.currentTarget);
    const passphrase = String(form.get('passphrase') ?? '').trim();
    try {
      await request('/ssh-keys', 'POST', {
        name: String(form.get('name') ?? '').trim(),
        privateKey: String(form.get('privateKey') ?? ''),
        ...(passphrase ? { passphrase } : {}),
      });
      (event.target as HTMLFormElement).reset();
    } catch (err) {
      setError((err as Error).message);
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
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <Modal title="Saved SSH keys" subtitle="Reuse one key across multiple agents." onClose={onClose}>
      <div className="form-body">
        {sshKeys.length > 0 && (
          <ul className="key-list">
            {sshKeys.map((key) => (
              <li key={key.id} className="key-list-item">
                <KeyRound size={14} />
                <span>{key.name}</span>
                <button
                  type="button"
                  className="button danger-text small"
                  disabled={!!busy}
                  onClick={() => void deleteKey(key)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void addKey(e)}>
          <label>
            Key name
            <input name="name" required maxLength={100} autoFocus placeholder="e.g. My server key" />
          </label>
          <label>
            Private key
            <textarea
              name="privateKey"
              className="mono"
              rows={4}
              required
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Key passphrase <span className="optional">optional</span>
            <input name="passphrase" type="password" autoComplete="new-password" />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <footer className="form-footer">
            <button type="button" className="button secondary" onClick={onClose}>
              Close
            </button>
            <button className="button primary" disabled={busy === 'add'}>
              {busy === 'add' ? 'Saving...' : 'Save key'}
            </button>
          </footer>
        </form>
      </div>
    </Modal>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  function commit(raw: string) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1));
    }
  }
  function onBlur() {
    if (input.trim()) commit(input);
  }
  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>×</button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        placeholder={value.length ? '' : (placeholder ?? 'Type and press Enter or comma')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={onBlur}
      />
    </div>
  );
}

export function AgentModal({
  agent,
  agents = [],
  sshKeys = [],
  openaiConfigured = false,
  roles = [],
  librarySkills = [],
  request,
  onClose,
  onSaved,
  onDeleted,
}: {
  agent?: Agent;
  agents?: Agent[];
  sshKeys?: SshKey[];
  openaiConfigured?: boolean;
  roles?: Role[];
  librarySkills?: Skill[];
  request: Request;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onDeleted: () => void;
}) {
  const [transport, setTransport] = useState<'ssh' | 'local'>(agent?.transport ?? 'ssh');
  const [localPath, setLocalPath] = useState(agent?.hermesPath ?? '');
  const [localWorkdir, setLocalWorkdir] = useState(agent?.workdir ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [roleSkillsBanner, setRoleSkillsBanner] = useState<Role | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>(agent?.capabilities ?? []);
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [generating, setGenerating] = useState(false);
  const [skills, setSkills] = useState<AgentSkill[]>(agent?.skills ?? []);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsTab, setSkillsTab] = useState<'browse' | 'url'>('browse');
  const [skillUrl, setSkillUrl] = useState('');
  const [skillBusy, setSkillBusy] = useState('');
  const [skillError, setSkillError] = useState('');
  const taken = agents.filter((other) => other.id !== agent?.id).map((other) => other.color);
  const [color, setColor] = useState<AgentColor>(
    agent?.color ?? agentColors.find((value) => !taken.includes(value)) ?? agentColors[0],
  );
  async function chooseLocal() {
    setTransport('local');
    try {
      const found = await request<{ hermesPath: string | null; workdir: string }>('/local-hermes');
      if (found.hermesPath) setLocalPath(found.hermesPath);
      if (found.workdir && !agent?.workdir) setLocalWorkdir(found.workdir);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const [auth, setAuth] = useState<Agent['authType']>(agent?.authType ?? 'privateKey');
  const [keySource, setKeySource] = useState<'saved' | 'paste'>(sshKeys.length > 0 ? 'saved' : 'paste');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [sshDetectedPath, setSshDetectedPath] = useState('');
  const [detectBusy, setDetectBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function detectHermes() {
    if (!agent) return;
    setDetectBusy(true);
    setError('');
    try {
      const result = await request<{ hermesPath: string }>(`/agents/${agent.id}/detect-hermes`, 'POST');
      setSshDetectedPath(result.hermesPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetectBusy(false);
    }
  }
  async function generateInstructions() {
    if (!agent && !role) return;
    setGenerating(true);
    setError('');
    try {
      const formName = (document.querySelector('[name="name"]') as HTMLInputElement | null)?.value ?? agent?.name ?? '';
      const result = await request<{ systemPrompt: string }>('/openai/generate-instructions', 'POST', {
        name: formName || agent?.name || 'Agent',
        role: role || undefined,
        capabilities: capabilities.length ? capabilities : undefined,
      });
      setSystemPrompt(result.systemPrompt);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function installSkillFromUrl() {
    if (!agent || !skillUrl.trim()) return;
    setSkillBusy('url');
    setSkillError('');
    try {
      const skill = await request<AgentSkill>(`/agents/${agent.id}/skills/fetch`, 'POST', { url: skillUrl.trim() });
      setSkills((prev) => [...prev, skill]);
      setSkillUrl('');
    } catch (err) {
      setSkillError((err as Error).message);
    } finally {
      setSkillBusy('');
    }
  }

  async function installCuratedSkill(slug: string) {
    if (!agent) return;
    const curated = curatedSkills.find((s) => s.slug === slug);
    if (!curated) return;
    setSkillBusy(slug);
    setSkillError('');
    try {
      const content = makeCuratedSkillMd(curated);
      const skill = await request<AgentSkill>(`/agents/${agent.id}/skills`, 'POST', { content, source: `curated:${slug}` });
      setSkills((prev) => [...prev, skill]);
    } catch (err) {
      setSkillError((err as Error).message);
    } finally {
      setSkillBusy('');
    }
  }

  async function removeSkill(skillId: string) {
    if (!agent) return;
    setSkillBusy(skillId);
    setSkillError('');
    try {
      await request(`/agents/${agent.id}/skills/${skillId}`, 'DELETE');
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (err) {
      setSkillError((err as Error).message);
    } finally {
      setSkillBusy('');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '');
    const credentials =
      auth === 'password'
        ? { password: text('password') }
        : { privateKey: text('privateKey'), passphrase: text('passphrase') };
    const usingSavedKey = transport === 'ssh' && auth === 'privateKey' && keySource === 'saved' && selectedKeyId;
    const input: AgentInput = {
      name: text('name').trim(),
      transport,
      host: transport === 'local' ? 'localhost' : text('host').trim(),
      port: transport === 'local' ? 22 : Number(text('port')),
      username: transport === 'local' ? 'local' : text('username').trim(),
      authType: auth,
      hermesPath: text('hermesPath').trim() || 'hermes',
      workdir: text('workdir').trim(),
      profile: text('profile').trim(),
      model: text('model').trim(),
      provider: text('provider').trim(),
      role: role.trim() || undefined,
      capabilities,
      systemPrompt: systemPrompt.trim() || undefined,
      color,
      toolPaths: Object.fromEntries(codingTools.map((tool) => [tool, text(`path-${tool}`).trim()])),
      toolModels: Object.fromEntries(codingTools.map((tool) => [tool, text(`model-${tool}`).trim()])),
      ...(usingSavedKey
        ? { sshKeyId: selectedKeyId }
        : transport === 'ssh' && (credentials.password || credentials.privateKey)
          ? { credentials }
          : {}),
    };
    // Edits send only what changed, so a model or colour change keeps the agent's verified connection.
    const blankTools = (value?: Record<string, string | undefined>) =>
      JSON.stringify(codingTools.map((tool) => value?.[tool] ?? ''));
    const body = agent
      ? Object.fromEntries(
          Object.entries(input).filter(([key, value]) => {
            const before = agent[key as keyof Agent];
            if (key === 'credentials') return true;
            if (key === 'toolPaths' || key === 'toolModels')
              return (
                blankTools(value as Record<string, string>) !== blankTools(before as Record<string, string>)
              );
            if (key === 'capabilities')
              return JSON.stringify(value ?? []) !== JSON.stringify(before ?? []);
            return (value ?? '') !== (before ?? '');
          }),
        )
      : { ...input };
    if (agent && !Object.keys(body).length) {
      setBusy(false);
      onSaved(agent);
      return;
    }
    try {
      const result = await request<Agent>(
        agent ? `/agents/${agent.id}` : '/agents',
        agent ? 'PATCH' : 'POST',
        body,
      );
      onSaved(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!agent || !confirm(`Remove ${agent.name} and its saved credentials? Task history will be kept.`))
      return;
    setBusy(true);
    try {
      await request(`/agents/${agent.id}`, 'DELETE');
      onDeleted();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={agent ? `Configure ${agent.name}` : 'Bring an agent into the loop'}
      subtitle="Connect to Hermes on this computer or over SSH."
      onClose={onClose}
    >
      <form className="form-body" onSubmit={submit}>
        <label>
          Agent name
          <input
            autoFocus
            name="name"
            required
            maxLength={100}
            defaultValue={agent?.name}
            placeholder="e.g. Atlas"
          />
        </label>
        <fieldset>
          <legend>Colour</legend>
          <div className="swatches" role="radiogroup" aria-label="Agent colour">
            {agentColors.map((value) => (
              <label
                key={value}
                className={taken.includes(value) ? 'taken' : ''}
                style={agentStyle({ color: value })}
                title={`${value}${taken.includes(value) ? ' (used by another agent)' : ''}`}
              >
                <input
                  type="radio"
                  name="color"
                  value={value}
                  aria-label={`${value}${taken.includes(value) ? ', used by another agent' : ''}`}
                  checked={color === value}
                  onChange={() => setColor(value)}
                />
                <span />
              </label>
            ))}
          </div>
          <p className="field-hint">Tasks, reports, and files from this agent are marked in this colour.</p>
        </fieldset>
        <fieldset>
          <legend>Connection</legend>
          <div className="segmented">
            <button
              type="button"
              disabled={!!agent}
              className={transport === 'ssh' ? 'active' : ''}
              onClick={() => setTransport('ssh')}
            >
              SSH
            </button>
            <button
              type="button"
              disabled={!!agent}
              className={transport === 'local' ? 'active' : ''}
              onClick={() => void chooseLocal()}
            >
              This computer
            </button>
          </div>
        </fieldset>
        {transport === 'ssh' && (
          <>
            <div className="form-grid host-grid">
              <label>
                Host / IP address
                <input
                  name="host"
                  required
                  defaultValue={agent?.host}
                  placeholder="192.168.1.21"
                  autoComplete="off"
                />
              </label>
              <label>
                SSH port
                <input
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  defaultValue={agent?.port ?? 22}
                />
              </label>
            </div>
            <label>
              SSH username
              <input
                name="username"
                required
                defaultValue={agent?.username}
                placeholder="hermes"
                autoComplete="off"
              />
            </label>
            <fieldset>
              <legend>Authentication</legend>
              <div className="segmented">
                <button
                  type="button"
                  className={auth === 'privateKey' ? 'active' : ''}
                  onClick={() => setAuth('privateKey')}
                >
                  <KeyRound size={15} />
                  Private key
                </button>
                <button
                  type="button"
                  className={auth === 'password' ? 'active' : ''}
                  onClick={() => setAuth('password')}
                >
                  <LockKeyhole size={15} />
                  Password
                </button>
              </div>
            </fieldset>
            {agent && (
              <p className="field-hint">
                Leave credentials blank to keep the saved{' '}
                {agent.authType === 'privateKey' ? 'key' : 'password'}. Changing authentication requires new
                credentials.
              </p>
            )}
            {auth === 'privateKey' ? (
              <>
                {sshKeys.length > 0 && (
                  <div className="segmented">
                    <button
                      type="button"
                      className={keySource === 'saved' ? 'active' : ''}
                      onClick={() => setKeySource('saved')}
                    >
                      <KeyRound size={15} />
                      Saved key
                    </button>
                    <button
                      type="button"
                      className={keySource === 'paste' ? 'active' : ''}
                      onClick={() => setKeySource('paste')}
                    >
                      Paste key
                    </button>
                  </div>
                )}
                {keySource === 'saved' && sshKeys.length > 0 ? (
                  <label>
                    SSH key
                    <select
                      value={selectedKeyId}
                      onChange={(e) => setSelectedKeyId(e.target.value)}
                      required={!agent || agent.authType !== auth}
                    >
                      <option value="">— select a saved key —</option>
                      {sshKeys.map((key) => (
                        <option key={key.id} value={key.id}>
                          {key.name}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">
                      The key is copied into this agent's credential. Deleting the saved key later has no
                      effect on this agent.
                    </span>
                  </label>
                ) : (
                  <>
                    <label>
                      Private key
                      <textarea
                        name="privateKey"
                        className="mono"
                        rows={4}
                        required={!agent || agent.authType !== auth}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Key passphrase <span className="optional">optional</span>
                      <input name="passphrase" type="password" autoComplete="new-password" />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setShowKeyManager(true)}
                >
                  <KeyRound size={14} />
                  Manage saved keys
                </button>
              </>
            ) : (
              <label>
                SSH password
                <input
                  name="password"
                  type="password"
                  required={!agent || agent.authType !== auth}
                  autoComplete="new-password"
                />
              </label>
            )}
          </>
        )}
        <fieldset>
          <legend>Model for managed tasks</legend>
          <label>
            Provider
            <input
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              maxLength={128}
              placeholder="Follow the global model"
              list="hermes-providers"
            />
            <datalist id="hermes-providers">
              <option value="nous" />
              <option value="openrouter" />
              <option value="openai-codex" />
              <option value="anthropic" />
              <option value="huggingface" />
              <option value="custom" />
            </datalist>
          </label>
          <label>
            Model ID
            <input
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={256}
              placeholder="Follow the global model"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              setModel('');
              setProvider('');
            }}
          >
            Follow the global model
          </button>
          <p className="field-hint">
            Leave both blank to follow the global model on the Models page, or Hermes’s own settings if none
            is set. Changes apply to new runs and do not require a new connection check.
          </p>
        </fieldset>
        <details className="connection-options" open={!!agent || transport === 'local'}>
          <summary>
            <Terminal size={15} />
            Hermes configuration
          </summary>
          <div className="details-content">
            <label>
              Hermes executable
              <div className="input-with-action">
                <input
                  name="hermesPath"
                  key={transport + localPath + sshDetectedPath}
                  defaultValue={
                    transport === 'local'
                      ? localPath
                      : sshDetectedPath || (agent?.hermesPath ?? 'hermes')
                  }
                  required={transport === 'local'}
                  placeholder="/home/user/.local/bin/hermes"
                />
                {transport === 'ssh' && agent && (
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={detectBusy || busy}
                    onClick={() => void detectHermes()}
                    title="SSH in and find the hermes binary automatically"
                  >
                    {detectBusy ? 'Detecting...' : 'Detect path'}
                  </button>
                )}
              </div>
              <span className="field-hint">
                {transport === 'local'
                  ? 'Absolute path to the Hermes executable on this computer.'
                  : 'Use an absolute path — SSH sessions may have a different PATH than your shell.'}
              </span>
              {sshDetectedPath && (
                <span className="field-hint" style={{ color: 'var(--color-success, green)' }}>
                  Detected: {sshDetectedPath}
                </span>
              )}
            </label>
            <label>
              Working directory
              <input
                name="workdir"
                key={transport + localWorkdir}
                defaultValue={transport === 'local' ? localWorkdir : (agent?.workdir ?? '')}
                placeholder={transport === 'local' ? 'Auto-detected above' : '/home/hermes/projects'}
                required={transport === 'local'}
              />
              <span className="field-hint">
                {transport === 'local'
                  ? 'Hermes will work in this directory. Use an absolute path.'
                  : 'Leave blank to use the Hermes default.'}
              </span>
            </label>
            <label>
              Hermes profile <span className="optional">optional</span>
              <input
                name="profile"
                defaultValue={agent?.profile}
                placeholder="Uses the installation default if empty"
              />
            </label>
            <label>
              Role <span className="optional">optional</span>
              <select
                name="role"
                value={role}
                onChange={(e) => {
                  const v = e.target.value;
                  setRole(v);
                  const matched = roles.find((r) => r.name.toLowerCase() === v.toLowerCase() || r.name === v);
                  setRoleSkillsBanner(matched && matched.skillIds.length > 0 ? matched : null);
                }}
              >
                <option value="">General (no specific role)</option>
                {agentRoles.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
                {roles.filter((r) => !agentRoles.some((ar) => ar.value === r.name.toLowerCase())).map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
              <span className="field-hint">Used for task routing and agent skill suggestions.</span>
            </label>
            {roleSkillsBanner && (() => {
              const bannerSkills = roleSkillsBanner.skillIds
                .map((id) => librarySkills.find((s) => s.id === id))
                .filter(Boolean) as Skill[];
              if (!bannerSkills.length) return null;
              const alreadyHave = new Set((agent?.skills ?? []).map((s) => s.source?.replace('library:', '')));
              const toInstall = bannerSkills.filter((s) => !alreadyHave.has(s.id));
              if (!toInstall.length) return null;
              return (
                <div className="role-skills-banner">
                  <span>
                    <strong>{roleSkillsBanner.name}</strong> has {toInstall.length} skill{toInstall.length > 1 ? 's' : ''}: {toInstall.map((s) => s.name).join(', ')}
                  </span>
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => {
                      const now = new Date().toISOString();
                      const newSkills: AgentSkill[] = toInstall.map((s) => ({
                        id: crypto.randomUUID(),
                        name: s.name,
                        description: s.description,
                        content: s.content,
                        source: `library:${s.id}`,
                        installedAt: now,
                      }));
                      setSkills((prev) => [...prev, ...newSkills]);
                      setRoleSkillsBanner(null);
                    }}
                  >
                    Add skills
                  </button>
                  <button type="button" className="icon-button" onClick={() => setRoleSkillsBanner(null)}>
                    <X size={14} />
                  </button>
                </div>
              );
            })()}
            <label>
              Capabilities <span className="optional">optional</span>
              <TagInput
                value={capabilities}
                onChange={setCapabilities}
                placeholder="e.g. python, testing — press Enter or comma"
              />
              <span className="field-hint">Skills used for smart task assignment.</span>
            </label>
            <label>
              System instructions <span className="optional">optional</span>
              <div className="system-prompt-row">
                <textarea
                  rows={3}
                  maxLength={4096}
                  placeholder="Instructions the agent always follows, e.g. 'You are a senior TypeScript developer…'"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!openaiConfigured || generating}
                  title={!openaiConfigured ? 'Configure OpenAI key in Settings → API Keys' : 'Generate with AI'}
                  onClick={() => void generateInstructions()}
                >
                  {generating ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                  Generate
                </button>
              </div>
              <span className="field-hint">Prepended to every task this agent runs.</span>
            </label>

            {agent && (
              <div className="skills-section">
                <button
                  type="button"
                  className="skills-toggle"
                  onClick={() => setSkillsOpen((v) => !v)}
                >
                  {skillsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Agent skills
                  {skills.length > 0 && <span className="skills-count">{skills.length}</span>}
                </button>
                {skillsOpen && (
                  <div className="skills-panel">
                    {skills.length > 0 && (
                      <div className="skills-chips">
                        {skills.map((skill) => (
                          <span key={skill.id} className="skill-chip">
                            {skill.name}
                            <button
                              type="button"
                              disabled={!!skillBusy}
                              onClick={() => void removeSkill(skill.id)}
                              aria-label={`Remove ${skill.name}`}
                            >
                              {skillBusy === skill.id ? <Loader2 size={11} className="spin" /> : <X size={11} />}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {skillError && <p className="form-error">{skillError}</p>}
                    <div className="skills-tabs">
                      <button type="button" className={skillsTab === 'browse' ? 'active' : ''} onClick={() => setSkillsTab('browse')}>Browse</button>
                      <button type="button" className={skillsTab === 'url' ? 'active' : ''} onClick={() => setSkillsTab('url')}>From URL</button>
                    </div>
                    {skillsTab === 'browse' && (
                      <div className="curated-skills">
                        {curatedSkills.map((cs) => {
                          const installed = skills.some((s) => s.source === `curated:${cs.slug}`);
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
                                disabled={installed || !!skillBusy}
                                onClick={() => void installCuratedSkill(cs.slug)}
                              >
                                {skillBusy === cs.slug ? <Loader2 size={11} className="spin" /> : <Plus size={11} />}
                                {installed ? 'Installed' : 'Install'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {skillsTab === 'url' && (
                      <div className="skill-url-form">
                        <input
                          type="url"
                          placeholder="https://raw.githubusercontent.com/…/SKILL.md"
                          value={skillUrl}
                          onChange={(e) => setSkillUrl(e.target.value)}
                          maxLength={2048}
                        />
                        <button
                          type="button"
                          className="button primary small"
                          disabled={!skillUrl.trim() || !!skillBusy}
                          onClick={() => void installSkillFromUrl()}
                        >
                          {skillBusy === 'url' ? <Loader2 size={13} className="spin" /> : 'Install'}
                        </button>
                        <span className="field-hint">Paste a raw URL to a SKILL.md file.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
        <details className="connection-options">
          <summary>
            <Terminal size={15} />
            Coding tools (Claude Code, Codex, OpenCode)
          </summary>
          <div className="details-content">
            <p className="field-hint">
              Connection checks find these on PATH and in common install folders. Set a path only if detection
              misses one. Leave models blank to follow the global coding model.
            </p>
            {codingTools.map((tool) => (
              <div className="form-grid" key={tool}>
                <label>
                  {runnerNames[tool]} path <span className="optional">optional</span>
                  <input
                    name={`path-${tool}`}
                    defaultValue={agent?.toolPaths?.[tool]}
                    placeholder={agent?.tools?.[tool]?.path ?? `Auto-detect ${tool}`}
                    autoComplete="off"
                  />
                </label>
                <label>
                  {runnerNames[tool]} model <span className="optional">optional</span>
                  <input
                    name={`model-${tool}`}
                    defaultValue={agent?.toolModels?.[tool]}
                    placeholder="Follow global"
                    autoComplete="off"
                  />
                </label>
              </div>
            ))}
          </div>
        </details>
        <div className="callout">
          <ShieldCheck size={17} />
          <p>
            {transport === 'local'
              ? 'Tasks run as the manager’s OS user using your local Hermes configuration. No SSH credentials are needed. Existing desktop sessions are not imported. Interactive shells require SSH.'
              : 'Credentials are encrypted in your local vault. Verify the host fingerprint before the first connection. Remote hosts must support a POSIX shell.'}
          </p>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          {agent && (
            <button type="button" className="button danger-text push-right" onClick={remove} disabled={busy}>
              <Trash2 size={16} />
              Remove
            </button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save agent'}
          </button>
        </footer>
      </form>
      {showKeyManager && (
        <SshKeyModal sshKeys={sshKeys} request={request} onClose={() => setShowKeyManager(false)} />
      )}
    </Modal>
  );
}

export function TaskForm({
  agents,
  status,
  request,
  onClose,
  onSaved,
}: {
  agents: Agent[];
  status?: TaskStatus;
  request: Request;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [runner, setRunner] = useState<Runner>('hermes');
  const [tags, setTags] = useState<string[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const selected = agents.find((agent) => agent.id === agentId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const task = await request<Task>('/tasks', 'POST', {
        title: data.get('title'),
        description: data.get('description'),
        agentId: data.get('agentId') || null,
        runner,
        workdir: String(data.get('workdir') ?? '').trim(),
        priority: data.get('priority'),
        status: data.get('status'),
        tags,
        chain: chain.length ? chain : undefined,
      });
      onSaved(task);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Make room for the next idea"
      subtitle="Create a task. Choose an agent. Stay in the loop."
      onClose={onClose}
    >
      <form className="form-body" onSubmit={submit}>
        <label>
          Task title
          <input name="title" autoFocus required maxLength={200} placeholder="What needs to get done?" />
        </label>
        <label>
          Instructions
          <textarea
            name="description"
            rows={5}
            maxLength={65536}
            placeholder="Give your agent context, a clear goal, and what a good result looks like."
          />
          <span className="field-hint">
            Sent as the prompt when you explicitly run the task. If empty, the title is used.
          </span>
        </label>
        <label>
          Required capabilities <span className="optional">optional</span>
          <TagInput
            value={tags}
            onChange={setTags}
            placeholder="e.g. python, testing — used by auto-assign"
          />
          <span className="field-hint">Auto-assign prefers agents whose capabilities match these tags.</span>
        </label>
        <label>
          Assign to
          <select name="agentId" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.transport === 'local' ? 'this computer' : agent.host})
              </option>
            ))}
          </select>
        </label>
        {agents.length > 1 && (
          <details className="chain-config">
            <summary>Sequential agent chain <span className="optional">optional</span></summary>
            <div className="chain-steps">
              <span className="field-hint">After the assigned agent finishes, these agents will run the task in order, each receiving the previous agent's output as context.</span>
              {chain.map((chainAgentId, index) => {
                const a = agents.find((ag) => ag.id === chainAgentId);
                return (
                  <div key={index} className="chain-step">
                    <span>Step {index + 2}: {a?.name ?? 'Unknown agent'}</span>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => setChain(chain.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setChain([...chain, e.target.value]);
                  e.target.value = '';
                }}
              >
                <option value="">Add agent to chain…</option>
                {agents
                  .filter((a) => a.id !== agentId && !chain.includes(a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </div>
          </details>
        )}
        <RunnerFields agent={selected} runner={runner} onRunner={setRunner} />
        <div className="form-grid">
          <label>
            Priority
            <select name="priority" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={status && status !== 'running' ? status : 'backlog'}>
              {statuses
                .filter((s) => s !== 'running')
                .map((s) => (
                  <option key={s} value={s}>
                    {statusNames[s]}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <p className="field-hint">
          Saving a task does not execute it. Running a task is always a separate action.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Creating...' : 'Create task'}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function TrustModal({
  agent,
  fingerprint,
  onClose,
  onTrust,
}: {
  agent: Agent;
  fingerprint: string;
  onClose: () => void;
  onTrust: () => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = !!agent.fingerprint && agent.fingerprint !== fingerprint;
  return (
    <Modal
      title={changed ? 'The host key has changed' : 'Verify this host'}
      subtitle={`${agent.username}@${agent.host}:${agent.port}`}
      onClose={onClose}
    >
      <div className="form-body">
        <div className={`callout ${changed ? 'warning' : ''}`}>
          <AlertTriangle size={20} />
          <p>
            {changed
              ? 'Stop unless you expected this change. A different key can mean a reinstalled host, or an intercepted connection.'
              : 'This is a new SSH host. Compare this fingerprint with the host itself or another trusted source before continuing. No credentials have been sent.'}
          </p>
        </div>
        {changed && (
          <label>
            Previously trusted fingerprint<code className="fingerprint">{agent.fingerprint}</code>
          </label>
        )}
        <label>
          Observed fingerprint<code className="fingerprint">{fingerprint}</code>
        </label>
        <p className="field-hint">
          On the remote host, use <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256</code> for
          an Ed25519 host key. Use the corresponding public-key file for other key types.
        </p>
        <label className="checkbox-label">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />I
          independently verified this fingerprint.
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!checked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onTrust();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Verifying...' : 'Trust host & check'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

const runnerHints: Record<Runner, string> = {
  hermes: 'Hermes runs the prompt with its own tools and permissions.',
  claude:
    'Claude Code may edit files in this folder without asking. Other tools stay restricted; if it needs one, the task waits on you.',
  codex: 'Codex runs in its workspace-write sandbox: it can edit this folder, and network access is off.',
  opencode: "OpenCode follows its own permission settings on the agent's machine.",
};

export function RunnerFields({
  agent,
  runner,
  onRunner,
  workdir,
  showWorkdir = true,
}: {
  agent?: Agent;
  runner: Runner;
  onRunner: (runner: Runner) => void;
  workdir?: string;
  showWorkdir?: boolean;
}) {
  return (
    <div className="runner-fields">
      <div className="form-grid">
        <label>
          Run with
          <select value={runner} onChange={(event) => onRunner(event.target.value as Runner)}>
            <option value="hermes">Hermes</option>
            {codingTools.map((tool) => {
              const missing = !!agent && !agent.tools?.[tool] && !agent.toolPaths?.[tool];
              return (
                <option key={tool} value={tool} disabled={missing && runner !== tool}>
                  {runnerNames[tool]}
                  {missing ? ' (not found)' : ''}
                </option>
              );
            })}
          </select>
        </label>
        {showWorkdir && (
          <label>
            Folder on the agent <span className="optional">optional</span>
            <input
              name="workdir"
              maxLength={4096}
              defaultValue={workdir}
              placeholder={agent?.workdir || 'Agent default'}
              autoComplete="off"
            />
          </label>
        )}
      </div>
      <span className="field-hint">{runnerHints[runner]}</span>
    </div>
  );
}

export function BulkModelModal({
  agents,
  request,
  onClose,
  onSaved,
}: {
  agents: Agent[];
  request: Request;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('nous');
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void request<{ models: { id: string }[] }>('/nous/models')
      .then((value) => setCatalog(value.models.map((m) => m.id)))
      .catch(() => {
        /* Suggestions are optional; any model ID can be typed. */
      });
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/agents/bulk', 'POST', {
        ids: agents.map((agent) => agent.id),
        model: model.trim(),
        provider: provider.trim(),
      });
      onSaved(agents.length);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Set a model for these agents"
      subtitle={`${agents.length} agent(s): ${agents.map((agent) => agent.name).join(', ')}`}
      onClose={onClose}
    >
      <form className="form-body" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Provider
            <input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              maxLength={128}
              list="hermes-providers-bulk"
            />
            <datalist id="hermes-providers-bulk">
              <option value="nous" />
              <option value="openrouter" />
              <option value="openai-codex" />
              <option value="anthropic" />
              <option value="custom" />
            </datalist>
          </label>
          <label>
            Model ID
            <input
              autoFocus
              required
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={256}
              list="nous-catalog-bulk"
              autoComplete="off"
            />
            <datalist id="nous-catalog-bulk">
              {catalog.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
        </div>
        <p className="field-hint">
          This overrides the global model for these agents only. Use “Use global model” on the agents page to
          undo it. Running tasks keep the model they started with.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving...' : `Apply to ${agents.length}`}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
