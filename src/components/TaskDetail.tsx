import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  Download,
  FileText,
  Play,
  Radio,
  Save,
  Send,
  StopCircle,
  Terminal,
  Trash2,
} from 'lucide-react';
import { runnerNames, type Agent, type Runner, type Task, type TaskLog } from '../../shared/types';
import { agentStyle, relativeTime, statusNames, statuses, type Request } from '../api';
import { RunnerFields } from './Forms';
import Modal from './Modal';

export default function TaskDetail({
  task,
  agents,
  request,
  demo,
  unlocked,
  onClose,
  onUnlock,
}: {
  task: Task;
  agents: Agent[];
  request: Request;
  demo: boolean;
  unlocked: boolean;
  onClose: () => void;
  onUnlock: () => void;
}) {
  const [tab, setTab] = useState<'details' | 'output' | 'report'>(
    task.report ? 'report' : task.status === 'running' ? 'output' : 'details',
  );
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [agentId, setAgentId] = useState(task.agentId ?? '');
  const [runner, setRunner] = useState<Runner>(task.runner ?? 'hermes');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastAgentIds, setBroadcastAgentIds] = useState<string[]>([]);
  const [groupedBroadcast, setGroupedBroadcast] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [handoffInstruction, setHandoffInstruction] = useState('');
  const running = task.status === 'running';
  const agent = agents.find((a) => a.id === task.agentId);
  const runnerName = runnerNames[task.runner ?? 'hermes'];
  const canReply = !running && !demo && !!task.startedAt && !!task.agentId;
  function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked) {
      onUnlock();
      return;
    }
    void action(`/tasks/${task.id}/reply`, 'POST', { message: reply }, () => {
      setReply('');
      setTab('output');
    });
  }
  useEffect(() => {
    if (demo) return;
    let disposed = false;
    const onLog = (event: Event) => {
      const log: TaskLog = (event as CustomEvent).detail;
      if (log.taskId === task.id)
        setLogs((current) => [...current.filter((item) => item.id !== log.id), log].slice(-2000));
    };
    window.addEventListener('manager:log', onLog);
    const loadLogs = () => {
      void request<TaskLog[]>(`/tasks/${task.id}/logs`)
        .then((value) => {
          if (!disposed)
            setLogs((current) =>
              [...new Map([...value, ...current].map((item) => [item.id, item])).values()]
                .sort((a, b) => a.id - b.id)
                .slice(-2000),
            );
        })
        .catch((error) => {
          if (!disposed) setError(error.message);
        });
    };
    loadLogs();
    window.addEventListener('manager:connected', loadLogs);
    return () => {
      disposed = true;
      window.removeEventListener('manager:log', onLog);
      window.removeEventListener('manager:connected', loadLogs);
    };
  }, [task.id, demo]);
  async function action(path: string, method: string, body?: unknown, success?: () => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(path, method, body);
      success?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(
      `/tasks/${task.id}`,
      'PATCH',
      {
        title: data.get('title'),
        description: data.get('description'),
        agentId: data.get('agentId') || null,
        runner,
        workdir: String(data.get('workdir') ?? '').trim(),
        priority: data.get('priority'),
        status: data.get('status'),
      },
      () => setNotice('Changes saved.'),
    );
  }
  function run() {
    if (!unlocked) {
      onUnlock();
      return;
    }
    if (
      !confirm(
        `Run this task on ${agent?.name ?? 'the assigned agent'} with ${runnerName}? It may execute commands and modify files according to its remote permissions.${task.startedAt ? '\n\nThis is a new run, not a resume. If a previous run was interrupted, check the remote host first to avoid duplicate work.' : ''}`,
      )
    )
      return;
    void action(`/tasks/${task.id}/run`, 'POST', undefined, () => setTab('output'));
  }
  function download() {
    const blob = new Blob(
      [
        `${task.title}\n${'='.repeat(task.title.length)}\n\nStatus: ${statusNames[task.status]}\nAgent: ${agents.find((a) => a.id === task.agentId)?.name ?? 'Unassigned'}\nUpdated: ${task.updatedAt}\n\n${task.report ?? ''}${task.error ? `\n\nError: ${task.error}` : ''}`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hermes-report-${task.id.slice(0, 8)}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function forceStop() {
    if (!confirm('Force-stop this task? It will move to blocked. Any work already done by the agent may still be in progress on the remote host.'))
      return;
    void action(`/tasks/${task.id}/abort`, 'POST', undefined, () => setNotice('Task force-stopped.'));
  }
  async function broadcast() {
    if (!broadcastAgentIds.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ tasks: Task[] }>(`/tasks/${task.id}/broadcast`, 'POST', {
        agentIds: broadcastAgentIds,
        grouped: groupedBroadcast,
      });
      setNotice(`Broadcast to ${result.tasks.length} agent${result.tasks.length === 1 ? '' : 's'}.`);
      setShowBroadcast(false);
      setBroadcastAgentIds([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function handoff() {
    if (!handoffAgentId) return;
    setBusy(true);
    setError('');
    try {
      await request(`/tasks/${task.id}/handoff`, 'POST', {
        agentId: handoffAgentId,
        instruction: handoffInstruction || undefined,
      });
      const target = agents.find((a) => a.id === handoffAgentId);
      setNotice(`Handed off to ${target?.name ?? 'agent'}.`);
      setShowHandoff(false);
      setHandoffAgentId('');
      setHandoffInstruction('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const resumable = !!task.sessionId && ((task.runner ?? 'hermes') !== 'hermes' || !!agent?.resume);
  const replyForm = canReply && (
    <form className="reply-box" onSubmit={sendReply}>
      <label>
        {task.status === 'waiting' ? `Reply to ${agent?.name ?? 'the agent'}` : 'Follow up'}
        <textarea
          rows={3}
          required
          maxLength={32768}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder={
            task.status === 'waiting'
              ? 'Answer the question or approve a next step…'
              : 'Ask for changes or a next step…'
          }
        />
      </label>
      <span className="field-hint">
        {resumable
          ? `Continues the same ${runnerName} session.`
          : `${runnerName} cannot continue this session here, so this starts a new run that includes the previous response.`}
      </span>
      <div className="inline-buttons">
        <button className="button primary" disabled={busy || !reply.trim()}>
          <Send size={14} />
          {busy ? 'Sending...' : 'Send reply'}
        </button>
      </div>
    </form>
  );
  return (
    <Modal
      title={task.title}
      subtitle={`${demo ? 'SAMPLE TASK' : `TASK ${task.id.slice(0, 8).toUpperCase()}`} / Updated ${relativeTime(task.updatedAt).toLowerCase()}`}
      onClose={onClose}
      wide
    >
      <div className="detail-meta" style={agentStyle(agent)}>
        {agent && (
          <span className="runner-chip" style={{ borderLeft: '3px solid var(--agent)' }}>
            {agent.name}
          </span>
        )}
        <span className="runner-chip">{runnerName}</span>
        <span className={`status-pill ${task.status}`}>
          <i />
          {statusNames[task.status]}
        </span>
        <span className={`priority ${task.priority}`}>
          <i />
          {task.priority} priority
        </span>
        {task.sessionId && <code title={task.sessionId}>Session {task.sessionId.slice(0, 12)}</code>}
        {(task.chainStep || task.chain?.length) ? (
          <span className="runner-chip chain-chip" title="This task is part of a sequential agent chain">
            <ArrowRight size={12} />
            {task.chainStep ? `Step ${task.chainStep}` : 'Chained'}
            {task.chain?.length ? ` — ${task.chain.length} more` : ''}
          </span>
        ) : null}
        {task.groupId && (
          <span className="runner-chip" title="Part of a parallel broadcast group">
            <Radio size={12} />
            Parallel run
          </span>
        )}
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Task information">
        {(['details', 'output', 'report'] as const).map((value, index, values) => (
          <button
            key={value}
            id={`tab-${value}`}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            aria-selected={tab === value}
            aria-controls="task-panel"
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % values.length
                  : event.key === 'ArrowLeft'
                    ? (index + values.length - 1) % values.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? values.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setTab(values[next]);
                document.getElementById(`tab-${values[next]}`)?.focus();
              }
            }}
          >
            {value === 'output' ? <Terminal size={15} /> : <FileText size={15} />}
            {value === 'details' ? 'Task details' : value === 'output' ? 'Live output' : 'Report'}
            {value === 'output' && running && <i className="live-dot" />}
          </button>
        ))}
      </div>
      <div id="task-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {task.status === 'waiting' && (
          <div className="callout warning detail-warning" role="status">
            <Bell size={17} />
            <p>
              <strong>{agent?.name ?? 'The agent'} is waiting on you.</strong> {task.waitingReason}
            </p>
          </div>
        )}
        {task.status === 'waiting' && replyForm}
        {task.error && (
          <div className="callout warning detail-warning">
            <AlertTriangle size={17} />
            <p>{task.error}</p>
          </div>
        )}
        {tab === 'details' && (
          <form className="form-body" onSubmit={save} key={`${task.id}-${task.status}-${task.updatedAt}`}>
            <fieldset disabled={running || busy || demo} className="task-fields">
              <label>
                Task title
                <input name="title" required maxLength={200} defaultValue={task.title} />
              </label>
              <label>
                Instructions
                <textarea
                  name="description"
                  rows={6}
                  maxLength={65536}
                  defaultValue={task.description}
                  placeholder="Describe the desired outcome..."
                />
              </label>
              <label>
                Assigned agent
                <select name="agentId" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <RunnerFields
                agent={agents.find((a) => a.id === agentId)}
                runner={runner}
                onRunner={setRunner}
                workdir={task.workdir}
              />
              <div className="form-grid">
                <label>
                  Priority
                  <select name="priority" defaultValue={task.priority}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={task.status}>
                    {statuses
                      .filter((s) => s !== 'running' || running)
                      .map((s) => (
                        <option key={s} value={s}>
                          {statusNames[s]}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </fieldset>
            {running && (
              <p className="field-hint">
                This task is running. Editing is paused until it finishes. Closing this dialog does not stop
                it.
              </p>
            )}
            {!running && !demo && (
              <div className="inline-actions">
                <button
                  type="button"
                  className="button danger-text"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('Delete this task and its saved logs?'))
                      void action(`/tasks/${task.id}`, 'DELETE', undefined, onClose);
                  }}
                >
                  <Trash2 size={15} />
                  Delete task
                </button>
                <button className="button secondary" disabled={busy}>
                  <Save size={15} />
                  {busy ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            )}
          </form>
        )}
        {tab === 'output' && (
          <div className="output-content">
            <div className="output-heading">
              <span>
                <i className={running ? 'live-dot' : 'muted-dot'} />
                {running ? 'Receiving live output' : 'Saved execution output'}
              </span>
              <span>{logs.length} entries</span>
            </div>
            <div className="task-log" tabIndex={0} aria-label="Task execution log">
              {logs.length ? (
                logs.map((log) => (
                  <div key={log.id} className={`log-line ${log.stream}`}>
                    <time>{new Date(log.createdAt).toLocaleTimeString([], { hour12: false })}</time>
                    <pre>{log.text}</pre>
                  </div>
                ))
              ) : (
                <p>
                  {demo
                    ? 'Sample tasks do not have real execution logs.'
                    : running
                      ? 'Waiting for the first output from Hermes...'
                      : 'No output yet. Logs appear here when this task runs.'}
                </p>
              )}
            </div>
            <p className="field-hint">
              Showing the latest saved entries. Logs may be truncated. Shell access is available separately in
              Terminal.
            </p>
          </div>
        )}
        {tab === 'report' && (
          <div className="report-content">
            {task.report ? (
              <>
                <div className="report-heading">
                  <span>
                    <FileText size={17} />
                    Agent completion report
                  </span>
                  <button className="button secondary small" onClick={download}>
                    <Download size={14} />
                    Export
                  </button>
                </div>
                <pre className="report-text">{task.report}</pre>
                <p className="field-hint">
                  An agent report is not independent verification. Review the outcome before marking this task
                  done.
                </p>
                {task.turns && task.turns.length > 2 && (
                  <details>
                    <summary>Conversation ({task.turns.length} messages)</summary>
                    <div className="thread">
                      {task.turns.map((turn, index) => (
                        <article key={index} className={turn.role} style={agentStyle(agent)}>
                          <header>
                            {turn.role === 'user' ? 'You' : (agent?.name ?? 'Agent')} ·{' '}
                            {relativeTime(turn.at)}
                          </header>
                          <pre>{turn.text}</pre>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
                {task.status !== 'waiting' && replyForm}
              </>
            ) : (
              <div className="empty-inline">
                <FileText size={30} />
                <h3>No report yet</h3>
                <p>The final response from Hermes will appear here when a run returns a result.</p>
              </div>
            )}
          </div>
        )}
      </div>
      {showBroadcast && !demo && (
        <div className="collab-panel">
          <strong>Broadcast to agents</strong>
          <p className="field-hint">Creates a copy of this task for each selected agent, ready to run.</p>
          <div className="broadcast-agents">
            {agents.filter((a) => a.id !== task.agentId).map((a) => (
              <label key={a.id} className="broadcast-agent-check">
                <input
                  type="checkbox"
                  checked={broadcastAgentIds.includes(a.id)}
                  onChange={(e) =>
                    setBroadcastAgentIds(
                      e.target.checked
                        ? [...broadcastAgentIds, a.id]
                        : broadcastAgentIds.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
                {a.role && <span className="muted"> — {a.role}</span>}
              </label>
            ))}
          </div>
          <label className="broadcast-grouped">
            <input type="checkbox" checked={groupedBroadcast} onChange={(e) => setGroupedBroadcast(e.target.checked)} />
            Link as parallel group (shows grouped in board)
          </label>
          <div className="inline-buttons">
            <button className="button secondary" type="button" onClick={() => setShowBroadcast(false)}>Cancel</button>
            <button
              className="button primary"
              type="button"
              disabled={busy || !broadcastAgentIds.length}
              onClick={() => void broadcast()}
            >
              <Radio size={14} />
              Broadcast to {broadcastAgentIds.length || '…'} agent{broadcastAgentIds.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
      {showHandoff && !demo && (
        <div className="collab-panel">
          <strong>Pass to another agent</strong>
          <p className="field-hint">Creates a follow-up task with the current report as context.</p>
          <label>
            Agent
            <select value={handoffAgentId} onChange={(e) => setHandoffAgentId(e.target.value)}>
              <option value="">Choose an agent…</option>
              {agents.filter((a) => a.id !== task.agentId).map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ''}</option>
              ))}
            </select>
          </label>
          <label>
            Handoff instructions <span className="optional">optional</span>
            <textarea
              rows={2}
              maxLength={4096}
              placeholder="e.g. Review the above and focus on security risks…"
              value={handoffInstruction}
              onChange={(e) => setHandoffInstruction(e.target.value)}
            />
          </label>
          <div className="inline-buttons">
            <button className="button secondary" type="button" onClick={() => setShowHandoff(false)}>Cancel</button>
            <button
              className="button primary"
              type="button"
              disabled={busy || !handoffAgentId}
              onClick={() => void handoff()}
            >
              <ArrowRight size={14} />
              Hand off
            </button>
          </div>
        </div>
      )}
      {(error || notice) && (
        <p
          className={error ? 'form-error detail-message' : 'success-message detail-message'}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
        </p>
      )}
      <footer className="detail-footer">
        <span>
          {demo
            ? 'Read-only sample task'
            : running
              ? 'The agent is working on this task.'
              : 'You stay in control of execution.'}
        </span>
        <div className="inline-buttons">
          {running && !demo && (
            <button className="button danger-text" disabled={busy} onClick={forceStop}>
              <StopCircle size={15} />
              Force stop
            </button>
          )}
          {!running && !demo && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => { setShowHandoff(!showHandoff); setShowBroadcast(false); }}
            >
              <ArrowRight size={15} />
              Pass to agent
            </button>
          )}
          {!running && !demo && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => { setShowBroadcast(!showBroadcast); setShowHandoff(false); }}
            >
              <Radio size={15} />
              Broadcast
            </button>
          )}
          {(task.status === 'review' || task.status === 'waiting') && (
            <button
              className="button secondary"
              disabled={busy || demo}
              onClick={() =>
                void action(`/tasks/${task.id}`, 'PATCH', { status: 'done' }, () =>
                  setNotice('Task marked done.'),
                )
              }
            >
              <Check size={16} />
              Mark done
            </button>
          )}
          {!running && (
            <button className="button primary" disabled={busy || demo || !task.agentId} onClick={run}>
              <Play size={15} />
              {busy ? 'Working...' : task.startedAt ? 'Run again' : 'Run task'}
            </button>
          )}
        </div>
      </footer>
    </Modal>
  );
}
