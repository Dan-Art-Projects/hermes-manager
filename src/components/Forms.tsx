import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  agentColors,
  codingTools,
  runnerNames,
  type Agent,
  type AgentColor,
  type AgentInput,
  type AppSnapshot,
  type Runner,
  type Task,
  type TaskStatus,
} from '../../shared/types';
import { agentStyle, statusNames, statuses, type Request } from '../api';
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

export function AgentModal({
  agent,
  agents = [],
  request,
  onClose,
  onSaved,
  onDeleted,
}: {
  agent?: Agent;
  agents?: Agent[];
  request: Request;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onDeleted: () => void;
}) {
  const [transport, setTransport] = useState<'ssh' | 'local'>(agent?.transport ?? 'ssh');
  const [localPath, setLocalPath] = useState(agent?.hermesPath ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? '');
  const taken = agents.filter((other) => other.id !== agent?.id).map((other) => other.color);
  const [color, setColor] = useState<AgentColor>(
    agent?.color ?? agentColors.find((value) => !taken.includes(value)) ?? agentColors[0],
  );
  async function chooseLocal() {
    setTransport('local');
    try {
      const found = await request<{ hermesPath: string | null }>('/local-hermes');
      if (found.hermesPath) setLocalPath(found.hermesPath);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const [auth, setAuth] = useState<Agent['authType']>(agent?.authType ?? 'privateKey');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      color,
      toolPaths: Object.fromEntries(codingTools.map((tool) => [tool, text(`path-${tool}`).trim()])),
      toolModels: Object.fromEntries(codingTools.map((tool) => [tool, text(`model-${tool}`).trim()])),
      ...(transport === 'ssh' && (credentials.password || credentials.privateKey) ? { credentials } : {}),
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
            return (value ?? '') !== (before ?? '');
          }),
        )
      : input;
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
              <input
                name="hermesPath"
                key={transport + localPath}
                defaultValue={transport === 'local' ? localPath : (agent?.hermesPath ?? 'hermes')}
                required={transport === 'local'}
                placeholder="/home/hermes/.local/bin/hermes"
              />
              <span className="field-hint">
                {transport === 'local'
                  ? 'Absolute path to the Hermes executable on this computer.'
                  : 'An absolute path is recommended. SSH may have a different PATH.'}
              </span>
            </label>
            <label>
              Working directory <span className="optional">optional</span>
              <input name="workdir" defaultValue={agent?.workdir} placeholder="/home/hermes/projects" />
            </label>
            <label>
              Hermes profile <span className="optional">optional</span>
              <input
                name="profile"
                defaultValue={agent?.profile}
                placeholder="Uses the installation default if empty"
              />
            </label>
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
