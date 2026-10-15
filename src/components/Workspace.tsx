import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  codingTools,
  runnerNames,
  type Agent,
  type Artifact,
  type CatalogModel,
  type ModelDefaults,
  type Runner,
  type Schedule,
  type ScheduleChainStep,
  type Task,
} from '../../shared/types';
import { agentStyle, type Request } from '../api';
import { RunnerFields } from './Forms';
import Modal from './Modal';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Request failed.');
const localInput = (iso: string) =>
  new Date(Date.parse(iso) - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Confirm({
  title,
  body,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={title} subtitle={body} onClose={onCancel}>
      <div className="form-body">
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <button className="button secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } catch (e) {
                setError(message(e));
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working…' : action}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function Schedules({
  request,
  agents,
  schedules,
  onTask,
}: {
  request: Request;
  agents: Agent[];
  schedules: Schedule[];
  onTask: (id: string) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Schedule | null>(null),
    [removing, setRemoving] = useState<Schedule | null>(null),
    [agentId, setAgentId] = useState(''),
    [runner, setRunner] = useState<Runner>('hermes'),
    [chain, setChain] = useState<ScheduleChainStep[]>([]);
  useEffect(() => {
    setAgentId(edit?.agentId ?? '');
    setRunner(edit?.runner ?? 'hermes');
    setChain(edit?.chain ?? []);
  }, [edit]);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError('');
    const data = new FormData(form);
    try {
      await request(edit ? `/schedules/${edit.id}` : '/schedules', edit ? 'PATCH' : 'POST', {
        title: data.get('title'),
        description: data.get('description'),
        agentId,
        runner,
        nextRun: new Date(String(data.get('nextRun'))).toISOString(),
        intervalMinutes: Number(data.get('intervalMinutes')),
        enabled: data.get('enabled') === 'on',
        chain: chain.length ? chain : undefined,
      });
      setEdit(null);
      form.reset();
      setAgentId('');
      setRunner('hermes');
      setChain([]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: Schedule) {
    setError('');
    try {
      await request(`/schedules/${item.id}`, 'PATCH', { enabled: !item.enabled });
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="workspace-panel">
      <p>
        Runs while this manager is open and the vault is unlocked. Busy agents wait; missed recurring runs are
        combined into one run. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form
        key={edit?.id ?? 'new'}
        className="workspace-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <h2>{edit ? 'Edit schedule' : 'Schedule a task'}</h2>
        <label>
          Title
          <input name="title" required maxLength={200} defaultValue={edit?.title} />
        </label>
        <label>
          Instructions
          <textarea name="description" rows={3} maxLength={64000} defaultValue={edit?.description} />
        </label>
        <label>
          Agent
          <select
            aria-label="Agent"
            name="agentId"
            required
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="" disabled>
              Select agent
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <RunnerFields
          agent={agents.find((a) => a.id === agentId)}
          runner={runner}
          onRunner={setRunner}
          showWorkdir={false}
        />
        <label>
          Next run
          <input
            name="nextRun"
            type="datetime-local"
            required
            defaultValue={edit ? localInput(edit.nextRun) : ''}
          />
        </label>
        <label>
          Repeat every (minutes; 0 = once)
          <input
            name="intervalMinutes"
            type="number"
            min={0}
            max={525600}
            required
            defaultValue={edit?.intervalMinutes ?? 1440}
          />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" name="enabled" defaultChecked={edit ? edit.enabled : true} />
          Enabled
        </label>
        <details className="chain-config">
          <summary>Downstream agents ({chain.length})</summary>
          <p className="field-hint">After this schedule completes, automatically create tasks for additional agents.</p>
          <div className="chain-steps">
            {chain.map((step, i) => {
              const stepAgent = agents.find((a) => a.id === step.agentId);
              return (
                <div key={i} className="chain-step">
                  <span className="chain-step-num">{i + 1}</span>
                  <select
                    className="field"
                    value={step.agentId}
                    onChange={(e) => setChain(chain.map((s, j) => j === i ? { ...s, agentId: e.target.value } : s))}
                  >
                    <option value="">— Select agent —</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <select
                    className="field"
                    value={step.trigger}
                    onChange={(e) => setChain(chain.map((s, j) => j === i ? { ...s, trigger: e.target.value as ScheduleChainStep['trigger'] } : s))}
                    title="When to trigger this step"
                  >
                    <option value="always">Always</option>
                    <option value="on-output">Only if previous produced output</option>
                  </select>
                  <input
                    className="field"
                    placeholder="Optional instruction override"
                    value={step.instruction ?? ''}
                    onChange={(e) => setChain(chain.map((s, j) => j === i ? { ...s, instruction: e.target.value || undefined } : s))}
                  />
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setChain(chain.filter((_, j) => j !== i))}
                    aria-label="Remove step"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => setChain([...chain, { agentId: '', trigger: 'always' }])}
          >
            <Plus size={13} /> Add downstream agent
          </button>
        </details>
        <div className="workspace-actions">
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : edit ? 'Save schedule' : 'Create schedule'}
          </button>
          {edit && (
            <button type="button" className="button secondary" onClick={() => setEdit(null)}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <div className="workspace-list">
        {schedules.length === 0 && <p>No schedules yet.</p>}
        {schedules.map((item) => {
          const agent = agents.find((a) => a.id === item.agentId);
          const overdue = Date.parse(item.nextRun) <= Date.now();
          return (
            <article key={item.id} style={agentStyle(agent)}>
              <h3>{item.title}</h3>
              <p>
                {agent?.name ?? 'Agent removed'} · {runnerNames[item.runner ?? 'hermes']} ·{' '}
                {item.enabled ? 'Enabled' : 'Paused'} ·{' '}
                {item.intervalMinutes ? `Every ${item.intervalMinutes} minutes` : 'Once'}
              </p>
              <p>Next: {new Date(item.nextRun).toLocaleString()}</p>
              {!item.enabled && overdue && (
                <p className="field-hint">
                  Enabling this schedule runs it right away, then keeps its interval.
                </p>
              )}
              {item.chain?.length ? (
                <p className="chain-info">
                  Chain: {item.chain.map((s) => agents.find((a) => a.id === s.agentId)?.name ?? '?').join(' → ')}
                </p>
              ) : null}
              {item.lastError && <p role="status">Waiting: {item.lastError}</p>}
              <div className="workspace-actions">
                {item.lastTaskId && (
                  <button className="button ghost" onClick={() => onTask(item.lastTaskId!)}>
                    Last run →
                  </button>
                )}
                <button className="button secondary" onClick={() => setEdit(item)}>
                  Edit
                </button>
                <button className="button secondary" onClick={() => void toggle(item)}>
                  {item.enabled ? 'Pause' : 'Enable'}
                </button>
                <button className="button secondary" onClick={() => setRemoving(item)}>
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {removing && (
        <Confirm
          title={`Delete schedule "${removing.title}"?`}
          body="Tasks it already created stay on the board."
          action="Delete schedule"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await request(`/schedules/${removing.id}`, 'DELETE');
            if (edit?.id === removing.id) setEdit(null);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

const previewable = (a: Artifact) => /\.(md|txt|csv|pdf)$/i.test(a.name);

export function Library({
  request,
  agents,
  tasks,
  media,
  onReport,
}: {
  request: Request;
  agents: Agent[];
  tasks: Task[];
  media: boolean;
  onReport: (id: string) => void;
}) {
  const [items, setItems] = useState<Artifact[]>([]),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [taskId, setTaskId] = useState(''),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<Artifact | null>(null),
    [preview, setPreview] = useState<{ item: Artifact; text?: string } | null>(null);
  const refresh = () =>
    request<Artifact[]>('/artifacts')
      .then(setItems)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Files must be at most 25 MB.');
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsDataURL(file);
      });
      await request('/artifacts', 'POST', { name: file.name, taskId: taskId || null, content });
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(item: Artifact) {
    if (/\.pdf$/i.test(item.name)) {
      setPreview({ item });
      return;
    }
    try {
      const response = await fetch(`/api/artifacts/${item.id}/file?inline=1`);
      if (!response.ok) throw new Error('Could not open this file.');
      const text = await response.text();
      setPreview({
        item,
        text: text.length > 1024 * 1024 ? `${text.slice(0, 1024 * 1024)}\n\n[Preview truncated]` : text,
      });
    } catch (e) {
      setError(message(e));
    }
  }
  const matches = (name: string) => name.toLowerCase().includes(query.toLowerCase());
  const agentFor = (id: string | null) =>
    agents.find((a) => a.id === tasks.find((t) => t.id === id)?.agentId);
  const files = items.filter(
    (a) => (media ? a.kind !== 'document' : a.kind === 'document') && matches(a.name),
  );
  return (
    <section className="workspace-panel">
      <p>
        After each run, new files saved directly in the task folder’s <code>artifacts/</code> directory are
        collected, from local and SSH agents. Upload other outputs here (up to 25 MB each).
      </p>
      <div className="workspace-actions">
        <label>
          Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an output…" />
        </label>
        <label>
          Attach upload to task
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">No task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {busy ? 'Uploading…' : 'Upload file'}
          <input
            type="file"
            disabled={busy}
            accept={
              media
                ? '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.ogg'
                : '.pdf,.txt,.md,.csv,.docx,.xlsx,.pptx'
            }
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="artifact-grid">
        {!media &&
          tasks
            .filter((t) => t.report && matches(t.title))
            .map((t) => (
              <article key={t.id} style={agentStyle(agents.find((a) => a.id === t.agentId))}>
                <span className="eyebrow">TASK REPORT</span>
                <h3>{t.title}</h3>
                <p>
                  {agents.find((a) => a.id === t.agentId)?.name ?? 'Unassigned'} · {t.status}
                </p>
                <button className="button secondary" onClick={() => onReport(t.id)}>
                  Read report
                </button>
              </article>
            ))}
        {files.map((a) => {
          const url = `/api/artifacts/${a.id}/file`;
          const agent = agentFor(a.taskId);
          return (
            <article key={a.id} style={agentStyle(agent)}>
              {a.kind === 'image' && <img src={url} alt={a.name} loading="lazy" />}
              {a.kind === 'video' && <video src={url} controls preload="metadata" />}
              {a.kind === 'audio' && <audio src={url} controls preload="metadata" />}
              <h3>{a.name}</h3>
              <p>
                {Math.ceil(a.size / 1024)} KB · {new Date(a.createdAt).toLocaleDateString()}
                {agent && ` · ${agent.name}`}
              </p>
              {a.taskId && tasks.some((t) => t.id === a.taskId) && (
                <button className="text-button" onClick={() => onReport(a.taskId!)}>
                  {tasks.find((t) => t.id === a.taskId)?.title}
                </button>
              )}
              <div className="artifact-actions">
                {previewable(a) && (
                  <button className="button secondary small" onClick={() => void open(a)}>
                    Preview
                  </button>
                )}
                <a className="button secondary small" href={`${url}?download=1`}>
                  Download
                </a>
                <button
                  className="button ghost small"
                  aria-label={`Delete ${a.name}`}
                  onClick={() => setRemoving(a)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {files.length === 0 && <p>No {media ? 'media files' : 'uploaded documents'} yet.</p>}
      {removing && (
        <Confirm
          title={`Delete "${removing.name}"?`}
          body="The file is removed from the library. Copies on agents are not touched."
          action="Delete file"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await request(`/artifacts/${removing.id}`, 'DELETE');
            setRemoving(null);
            await refresh();
          }}
        />
      )}
      {preview && (
        <Modal title={preview.item.name} subtitle="Preview" onClose={() => setPreview(null)} wide>
          {preview.text !== undefined ? (
            <pre className="preview-text">{preview.text}</pre>
          ) : (
            <iframe
              className="preview-frame"
              title={preview.item.name}
              src={`/api/artifacts/${preview.item.id}/file?inline=1`}
            />
          )}
        </Modal>
      )}
    </section>
  );
}

type Target = 'global' | 'agents';

export function Models({
  request,
  agents,
  defaults,
}: {
  request: Request;
  agents: Agent[];
  defaults: ModelDefaults;
}) {
  const [key, setKey] = useState(''),
    [configured, setConfigured] = useState(false),
    [models, setModels] = useState<CatalogModel[]>([]),
    [fetchedAt, setFetchedAt] = useState<string | null>(null),
    [free, setFree] = useState(false),
    [query, setQuery] = useState(''),
    [target, setTarget] = useState<Target>('global'),
    [chosen, setChosen] = useState<string[]>([]),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async (refresh = false) => {
    const result = await request<{ models: CatalogModel[]; fetchedAt: string }>(
      `/nous/models${refresh ? '?refresh=1' : ''}`,
    );
    setModels(result.models);
    setFetchedAt(result.fetchedAt);
    return result.models.length;
  };
  useEffect(() => {
    void request<{ configured: boolean; fetchedAt: string | null }>('/nous')
      .then((r) => {
        setConfigured(r.configured);
        if (r.configured || r.fetchedAt) void load().catch(() => {});
      })
      .catch((e) => setStatus(message(e)));
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await fn();
    } catch (e) {
      setStatus(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply(model: string, provider: string) {
    if (target === 'global') {
      await request('/defaults', 'PUT', { ...defaults, model, provider });
      setStatus(`Global model set to ${model}. Agents without an override use it on their next run.`);
    } else {
      await request('/agents/bulk', 'POST', { ids: chosen, model, provider });
      setStatus(`Selected ${model} for ${chosen.length} agent(s).`);
    }
  }
  const filtered = models.filter(
    (m) => (!free || m.free) && `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const overrides = agents.filter((a) => a.model || a.provider);
  return (
    <section className="workspace-panel">
      <form
        className="defaults-panel"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const text = (name: string) => String(data.get(name) ?? '').trim();
          void action(async () => {
            await request('/defaults', 'PUT', {
              model: text('model'),
              provider: text('provider'),
              tools: Object.fromEntries(codingTools.map((tool) => [tool, text(`tool-${tool}`)])),
            });
            setStatus('Global models saved.');
          });
        }}
        key={JSON.stringify(defaults)}
      >
        <h2>Global models</h2>
        <p>
          Every agent without its own override uses these on its next run. Swap a model here to change the
          whole fleet at once.
          {overrides.length > 0 &&
            ` ${overrides.length} agent(s) have an override: ${overrides.map((a) => a.name).join(', ')}.`}
        </p>
        <label>
          Hermes provider
          <input
            name="provider"
            defaultValue={defaults.provider}
            placeholder="Hermes default"
            maxLength={256}
          />
        </label>
        <label>
          Hermes model
          <input
            name="model"
            defaultValue={defaults.model}
            placeholder="Hermes default"
            maxLength={256}
            list="catalog-ids"
          />
        </label>
        {codingTools.map((tool) => (
          <label key={tool}>
            {runnerNames[tool]} model
            <input
              name={`tool-${tool}`}
              defaultValue={defaults.tools[tool]}
              placeholder={`${runnerNames[tool]} default`}
              maxLength={256}
            />
          </label>
        ))}
        <datalist id="catalog-ids">
          {models.map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
        <div className="workspace-actions">
          <button className="button primary" disabled={busy}>
            Save global models
          </button>
          {overrides.length > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await request('/agents/bulk', 'POST', {
                    ids: overrides.map((a) => a.id),
                    model: '',
                    provider: '',
                  });
                  setStatus(`${overrides.length} agent(s) now follow the global model.`);
                })
              }
            >
              Clear all overrides
            </button>
          )}
        </div>
      </form>
      <p>
        {models.length
          ? 'Search the Nous catalog below, then choose where the model applies and select Use this model.'
          : configured
            ? 'Select Refresh models to load the Nous catalog, then search it below.'
            : 'To search Nous models, paste your Nous Portal API key and select Verify and save key. The catalog loads right away.'}{' '}
        The key is encrypted in your vault and only lists models; agents keep their own Nous sign-in.
      </p>
      <form
        className="workspace-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const result = await request<{ count: number; fetchedAt: string }>('/nous', 'PUT', {
              apiKey: key,
            });
            setKey('');
            setConfigured(true);
            await load();
            setStatus(`Key verified and saved. ${result.count} models available.`);
          });
        }}
      >
        <label>
          {configured ? 'Replace catalog API key' : 'Nous catalog API key'}
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          Verify and save key
        </button>
        {configured && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request('/nous', 'DELETE');
                setConfigured(false);
                setModels([]);
                setFetchedAt(null);
                setStatus('Key removed.');
              })
            }
          >
            Remove key
          </button>
        )}
      </form>
      <div className="workspace-actions">
        <button
          className="button secondary"
          disabled={busy || !configured}
          onClick={() =>
            void action(async () => {
              const count = await load(true);
              setStatus(`Loaded ${count} models.`);
            })
          }
        >
          {busy ? 'Working…' : 'Refresh models'}
        </button>
        <label>
          Search models
          {models.length > 0 && (
            <span className="optional">
              {filtered.length} of {models.length}
            </span>
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!models.length}
            placeholder={
              models.length ? 'Name or ID, e.g. hermes, qwen, 70b' : 'Save your key to load models'
            }
          />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          Free only
        </label>
      </div>
      <fieldset className="target-picker">
        <legend>“Use this model” applies to</legend>
        <label className="chip">
          <input
            type="radio"
            name="target"
            checked={target === 'global'}
            onChange={() => setTarget('global')}
          />
          Global default
        </label>
        <label className="chip">
          <input
            type="radio"
            name="target"
            checked={target === 'agents'}
            onChange={() => setTarget('agents')}
          />
          Specific agents
        </label>
        {target === 'agents' && (
          <>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setChosen(chosen.length === agents.length ? [] : agents.map((a) => a.id))}
            >
              {chosen.length === agents.length ? 'None' : 'All agents'}
            </button>
            {agents.map((a) => (
              <label className="chip" key={a.id} style={agentStyle(a)}>
                <input
                  type="checkbox"
                  checked={chosen.includes(a.id)}
                  onChange={(e) =>
                    setChosen((current) =>
                      e.target.checked ? [...current, a.id] : current.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </>
        )}
      </fieldset>
      <p>
        Free means both token prices are explicitly zero, excluding subscriptions. Unknown pricing is
        excluded. Availability and prices can change.
        {fetchedAt && ` Catalog updated ${new Date(fetchedAt).toLocaleString()}.`}
      </p>
      {status && <p role="status">{status}</p>}
      <div className="workspace-list">
        {filtered.map((m) => {
          const users = agents.filter((a) => a.model === m.id);
          return (
            <article key={m.id}>
              <h3>{m.name}</h3>
              <code>{m.id}</code>
              <p>
                {m.free
                  ? 'Free'
                  : m.input === null || m.output === null
                    ? 'Pricing unknown'
                    : `Input $${m.input} / output $${m.output} per million tokens`}
              </p>
              {(defaults.model === m.id || users.length > 0) && (
                <p>
                  In use:{' '}
                  {[defaults.model === m.id ? 'global default' : '', ...users.map((a) => a.name)]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              <button
                className="button secondary"
                disabled={busy || (target === 'agents' && !chosen.length)}
                onClick={() => void action(() => apply(m.id, 'nous'))}
              >
                Use this model
              </button>
            </article>
          );
        })}
      </div>
      {models.length > 0 && filtered.length === 0 && <p>No matching models.</p>}
    </section>
  );
}
