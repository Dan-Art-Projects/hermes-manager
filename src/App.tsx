import { lazy, Suspense, useDeferredValue, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Activity,
  ArrowDown,
  Bell,
  BellOff,
  CalendarClock,
  Code2,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  FolderKanban,
  Github,
  HelpCircle,
  LayoutGrid,
  List,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  UnlockKeyhole,
  X,
} from 'lucide-react';
import {
  effectiveModel,
  runnerNames,
  type Agent,
  type AppSnapshot,
  type Task,
  type TaskStatus,
} from '../shared/types';
import {
  ApiError,
  agentStyle,
  attention,
  relativeTime,
  statusNames,
  statuses,
  useManager,
  type AttentionItem,
} from './api';
import { demoState } from './demo';
import Modal from './components/Modal';
import { AgentModal, BulkModelModal, TaskForm, TrustModal, VaultModal } from './components/Forms';
import AttentionInbox from './components/Attention';
import TaskDetail from './components/TaskDetail';
import { Schedules, Library } from './components/Workspace';
import GitHub from './components/GitHub';
import Settings, { type Theme } from './components/Settings';

const TerminalPanel = lazy(() => import('./components/TerminalPanel'));
type View = 'board' | 'agents' | 'reports' | 'terminal' | 'schedules' | 'documents' | 'media' | 'github' | 'settings';
type Dialog =
  | { kind: 'agent'; agent?: Agent }
  | { kind: 'task'; status?: TaskStatus }
  | { kind: 'detail'; id: string }
  | { kind: 'vault'; next?: 'agent' }
  | { kind: 'trust'; agent: Agent; fingerprint: string }
  | { kind: 'help' }
  | null;
const viewNames: Record<View, string> = {
  board: 'Task board',
  agents: 'Agents',
  reports: 'Reports',
  terminal: 'Terminal',
  schedules: 'Schedules',
  documents: 'Documents',
  media: 'Media gallery',
  github: 'GitHub',
  settings: 'Settings',
};
const blank: AppSnapshot = {
  agents: [],
  tasks: [],
  activity: [],
  schedules: [],
  sshKeys: [],
  defaults: { model: '', provider: '', tools: {} },
  vault: { configured: false, unlocked: false },
  csrfToken: '',
  github: { configured: false },
  githubSyncs: [],
};

function Logo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M12 9v22m16-22v22M12 20h16M4 11h8M6 16h6M28 11h8M28 16h6"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="square"
      />
    </svg>
  );
}
function Avatar({
  agent,
  small = false,
  needsYou = false,
}: {
  agent?: Agent;
  small?: boolean;
  needsYou?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? 'avatar-small' : ''} ${needsYou ? 'needs-you' : ''}`}
      style={agentStyle(agent)}
      title={needsYou ? `${agent?.name ?? 'Agent'} is waiting on you` : undefined}
    >
      {agent ? agent.name.slice(0, 1).toUpperCase() : <Bot size={small ? 13 : 21} />}
    </span>
  );
}
function AgentStatus({ agent }: { agent: Agent }) {
  return (
    <span className={`agent-status ${agent.status}`}>
      <i />
      {agent.status === 'busy'
        ? 'Working'
        : agent.status === 'unknown'
          ? 'Unchecked'
          : agent.status === 'online'
            ? 'Reachable'
            : 'Offline'}
    </span>
  );
}

export default function App() {
  const { state: realState, connected, error: connectionError, outdated, request } = useManager();
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View>('board');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.toLowerCase());
  const [agentFilter, setAgentFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [checking, setChecking] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [terminalAgent, setTerminalAgent] = useState<string>();
  const [userName, setUserName] = useState<string>(() => {
    try { return localStorage.getItem('hermes-manager:name') ?? ''; } catch { return ''; }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('hermes-manager:theme') as Theme) ?? 'jade'; } catch { return 'jade'; }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'jade') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);
  function saveName(value: string) {
    setUserName(value);
    try { localStorage.setItem('hermes-manager:name', value); } catch {}
  }
  function saveTheme(value: Theme) {
    setTheme(value);
    try { localStorage.setItem('hermes-manager:theme', value); } catch {}
  }
  const state = demo ? demoState : (realState ?? blank);
  const needs = attention(state);
  const waitingAgents = new Set(
    state.tasks.filter((t) => t.status === 'waiting' && t.agentId).map((t) => t.agentId as string),
  );
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [bulkModel, setBulkModel] = useState(false);
  const [notify, setNotify] = useState(() => {
    try {
      return localStorage.getItem('hermes-manager:notify') === '1' && Notification.permission === 'granted';
    } catch {
      return false;
    }
  });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    document.title = needs.length
      ? `(${needs.length}) Hermes Manager | Local Agent Workspace`
      : 'Hermes Manager | Local Agent Workspace';
  }, [needs.length]);
  useEffect(() => {
    if (demo || !realState) return;
    const items = attention(realState);
    const previous = seen.current;
    seen.current = new Set(items.map((item) => item.key));
    if (!previous || !notify || typeof Notification === 'undefined' || Notification.permission !== 'granted')
      return;
    for (const item of items.filter((value) => !previous.has(value.key)).slice(0, 3)) {
      const note = new Notification(item.kind === 'question' ? `Needs you: ${item.title}` : item.title, {
        body: item.detail,
        tag: item.key,
      });
      note.onclick = () => {
        window.focus();
        openAttention(item);
      };
    }
  }, [realState, notify, demo]);
  function openAttention(item: AttentionItem) {
    if (item.target === 'task' && item.taskId) setDialog({ kind: 'detail', id: item.taskId });
    else if (item.target === 'vault') setDialog({ kind: 'vault' });
    else if (item.target !== 'task') navigate(item.target);
  }
  async function toggleNotify() {
    const remember = (value: boolean) => {
      setNotify(value);
      try {
        localStorage.setItem('hermes-manager:notify', value ? '1' : '0');
      } catch {
        /* Preference only lasts for this tab. */
      }
    };
    if (notify) {
      remember(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      setToast({ message: 'This browser does not support desktop notifications.', error: true });
      return;
    }
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
      remember(true);
      setToast({ message: 'Desktop notifications on. You will hear about anything that needs you.' });
    } else
      setToast({
        message: 'Notifications are blocked for this site. Allow them in your browser settings.',
        error: true,
      });
  }
  const online = state.agents.filter((a) => a.status === 'online' || a.status === 'busy').length;
  const running = state.tasks.filter((t) => t.status === 'running');
  const review = state.tasks.filter((t) => t.status === 'review');
  const done = state.tasks.filter((t) => t.status === 'done');
  const tasks = state.tasks.filter(
    (task) =>
      (agentFilter === 'all' ||
        (agentFilter === 'unassigned' ? !task.agentId : task.agentId === agentFilter)) &&
      (priorityFilter === 'all' || task.priority === priorityFilter) &&
      `${task.title} ${task.description} ${state.agents.find((a) => a.id === task.agentId)?.name ?? ''}`
        .toLowerCase()
        .includes(query),
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => {
      setSmallScreen(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
    };
    media.addEventListener('change', resize);
    window.addEventListener('keydown', escape);
    return () => {
      media.removeEventListener('change', resize);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
  }
  function addAgent() {
    if (demo) {
      setDemo(false);
      setAgentFilter('all');
    }
    setDialog(realState?.vault.unlocked ? { kind: 'agent' } : { kind: 'vault', next: 'agent' });
  }
  function sampleNotice() {
    setToast({ message: 'This is a read-only sample workspace. Switch to your workspace to make changes.' });
  }
  async function probe(agent: Agent) {
    if (demo) {
      sampleNotice();
      return;
    }
    if (!state.vault.unlocked) {
      setDialog({ kind: 'vault' });
      return;
    }
    setChecking((current) => [...current, agent.id]);
    try {
      await request(`/agents/${agent.id}/probe`, 'POST');
      setToast({ message: `${agent.name} is reachable and ready for tasks.` });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'HOST_KEY_UNTRUSTED' && error.fingerprint)
        setDialog({ kind: 'trust', agent, fingerprint: error.fingerprint });
      else setToast({ message: (error as Error).message, error: true });
    } finally {
      setChecking((current) => current.filter((id) => id !== agent.id));
    }
  }
  async function probeAll() {
    if (demo) { sampleNotice(); return; }
    if (!state.vault.unlocked) { setDialog({ kind: 'vault' }); return; }
    if (!state.agents.length) return;
    const queue = [...state.agents];
    const failed: string[] = [];
    setChecking((current) => [...current, ...queue.map((a) => a.id)]);
    const worker = async () => {
      for (let agent = queue.shift(); agent; agent = queue.shift()) {
        try {
          await request(`/agents/${agent.id}/probe`, 'POST');
        } catch {
          failed.push(agent.name);
        } finally {
          const id = agent.id;
          setChecking((current) => current.filter((v) => v !== id));
        }
      }
    };
    const total = state.agents.length;
    await Promise.all([worker(), worker(), worker(), worker()]);
    setToast(
      failed.length
        ? { message: `${total - failed.length} of ${total} agents reachable. Offline: ${failed.join(', ')}.`, error: true }
        : { message: `All ${total} agent${total === 1 ? '' : 's'} are reachable.` },
    );
  }
  async function bulkProbe() {
    if (demo) {
      sampleNotice();
      return;
    }
    if (!state.vault.unlocked) {
      setDialog({ kind: 'vault' });
      return;
    }
    const queue = state.agents.filter((agent) => selectedAgents.includes(agent.id));
    const failed: string[] = [];
    setChecking((current) => [...current, ...queue.map((agent) => agent.id)]);
    // The server allows eight SSH operations at once; four leaves room for running tasks.
    const worker = async () => {
      for (let agent = queue.shift(); agent; agent = queue.shift()) {
        try {
          await request(`/agents/${agent.id}/probe`, 'POST');
        } catch {
          failed.push(agent.name);
        } finally {
          const id = agent.id;
          setChecking((current) => current.filter((value) => value !== id));
        }
      }
    };
    const total = queue.length;
    await Promise.all([worker(), worker(), worker(), worker()]);
    setToast(
      failed.length
        ? {
            message: `${total - failed.length} of ${total} agents ready. Check ${failed.join(', ')}.`,
            error: true,
          }
        : { message: `All ${total} selected agents are ready.` },
    );
  }
  async function bulkClearModel() {
    if (demo) {
      sampleNotice();
      return;
    }
    try {
      await request('/agents/bulk', 'POST', { ids: selectedAgents, model: '', provider: '' });
      setToast({ message: `${selectedAgents.length} agent(s) now follow the global model.` });
    } catch (error) {
      setToast({ message: (error as Error).message, error: true });
    }
  }
  async function moveTask(event: DragEvent, status: TaskStatus) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    setDragged(null);
    if (demo || !id) return;
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (status === 'running') {
      setDialog({ kind: 'detail', id });
      setToast({
        message: 'Use Run task to explicitly start the agent. Moving a card never launches commands.',
      });
      return;
    }
    try {
      await request(`/tasks/${id}`, 'PATCH', { status });
    } catch (error) {
      setToast({ message: (error as Error).message, error: true });
    }
  }
  async function autoAssign() {
    try {
      const result = await request<{ assigned: number }>('/tasks/auto-assign', 'POST', {});
      setToast({
        message:
          result.assigned === 0
            ? 'No unassigned backlog tasks or no online agents available.'
            : `Auto-assigned ${result.assigned} task${result.assigned === 1 ? '' : 's'} to available agents.`,
        error: false,
      });
    } catch (error) {
      setToast({ message: (error as Error).message, error: true });
    }
  }
  function switchDemo() {
    setDemo(!demo);
    setSearch('');
    setAgentFilter('all');
    setPriorityFilter('all');
    setDialog(null);
    setTerminalAgent(undefined);
  }
  function openTerminal(agent: Agent) {
    setTerminalAgent(agent.id);
    navigate('terminal');
  }
  const selectedTask =
    dialog?.kind === 'detail' ? state.tasks.find((task) => task.id === dialog.id) : undefined;

  return (
    <div className="app-shell">
      {mobileNav && (
        <button className="nav-overlay" aria-label="Close navigation" onClick={() => setMobileNav(false)} />
      )}
      <aside
        id="workspace-navigation"
        className={`sidebar ${mobileNav ? 'is-open' : ''}`}
        inert={smallScreen && !mobileNav}
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('board');
          }}
        >
          <span className="brand-symbol">
            <Logo />
          </span>
          <span>
            hermes<span className="brand-manager">MANAGER</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-icon">
            <Network size={16} />
          </span>
          <div>
            Local workspace<small>Your agents, connected</small>
          </div>
          <span className="workspace-live" />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'board', icon: FolderKanban },
              { id: 'agents', icon: Bot },
              { id: 'reports', icon: FileText },
              { id: 'terminal', icon: Terminal },
              { id: 'schedules', icon: Clock3 },
              { id: 'github', icon: Github },
              { id: 'documents', icon: FileText },
              { id: 'media', icon: LayoutGrid },
              { id: 'settings', icon: Settings2 },
            ] as const
          ).map((item) => (
            <button
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{viewNames[item.id]}</span>
              {item.id === 'board' && needs.length > 0 && (
                <span className="nav-count needs-you" title={`${needs.length} item(s) need you`}>
                  {needs.length}
                </span>
              )}
              {item.id === 'board' && !needs.length && state.tasks.length > 0 && (
                <span className="nav-count">{state.tasks.length}</span>
              )}
              {item.id === 'reports' && review.length > 0 && <span className="nav-notification" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-agents">
          <div className="nav-caption">
            YOUR AGENTS
            <button className="sidebar-icon" aria-label="Add agent" onClick={addAgent}>
              <Plus size={15} />
            </button>
          </div>
          {state.agents.slice(0, 12).map((agent) => (
            <button
              className={`sidebar-agent ${waitingAgents.has(agent.id) ? 'needs-you' : ''}`}
              style={agentStyle(agent)}
              key={agent.id}
              onClick={() => {
                setAgentFilter(agent.id);
                navigate('board');
              }}
            >
              <i className="agent-swatch" aria-hidden="true" />
              <i className={`agent-dot ${agent.status}`} />
              <span>{agent.name}</span>
              {waitingAgents.has(agent.id) && <span className="sr-only">, waiting on you</span>}
              <span className="agent-task-count">
                {state.tasks.filter((t) => t.agentId === agent.id && t.status !== 'done').length}
              </span>
            </button>
          ))}
          {!state.agents.length && (
            <p className="sidebar-empty">
              A good team starts
              <br />
              with your first agent.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={19} />
            </span>
            <strong>Local by design.</strong>
            <p>
              Your workspace and SSH vault
              <br />
              stay on this machine.
            </p>
            <button onClick={() => setDialog({ kind: 'help' })}>
              How it works
              <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="notify-toggle" aria-pressed={notify} onClick={() => void toggleNotify()}>
            {notify ? <Bell size={15} /> : <BellOff size={15} />}
            {notify ? 'Desktop alerts on' : 'Turn on desktop alerts'}
          </button>
          <button className="sidebar-help" onClick={() => setDialog({ kind: 'help' })}>
            <HelpCircle size={17} />
            Quick start & help
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <span>Y</span>
            <div>
              Your workspace<small>Personal / local instance</small>
            </div>
            <LockKeyhole size={14} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <Network size={15} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{viewNames[view]}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-indicator ${connected ? 'connected' : ''}`}>
              <i />
              {connected ? 'Local connection' : 'Reconnecting'}
            </span>
            <span className="topbar-divider" />
            <button
              className="vault-button"
              onClick={async () => {
                if (demo) {
                  sampleNotice();
                  return;
                }
                if (!state.vault.unlocked) {
                  setDialog({ kind: 'vault' });
                  return;
                }
                try {
                  await request('/vault/lock', 'POST');
                  setToast({ message: 'Vault locked. Saved credentials remain encrypted.' });
                } catch (error) {
                  setToast({ message: (error as Error).message, error: true });
                }
              }}
            >
              {state.vault.unlocked ? <UnlockKeyhole size={15} /> : <LockKeyhole size={15} />}
              <span>
                {state.vault.unlocked
                  ? 'Lock vault'
                  : state.vault.configured
                    ? 'Unlock vault'
                    : 'Set up vault'}
              </span>
            </button>
            <button className="user-avatar" onClick={() => navigate('settings')} title="Settings">
              {userName ? userName.slice(0, 1).toUpperCase() : <Settings2 size={14} />}
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <Sparkles size={15} />
              <strong>Sample workspace</strong>
              <span>Explore the layout. No agents are connected and no commands will run.</span>
            </span>
            <button onClick={switchDemo}>
              Back to my workspace
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        {outdated && !demo && (
          <div className="connection-banner" role="alert">
            <Radio size={17} />
            The manager server is running older code than this page, so Models, Schedules, and Documents will
            fail. Stop the server and start it again with npm start or npm run dev.
          </div>
        )}
        {connectionError && !demo && (
          <div className="connection-banner" role="alert">
            <Radio size={17} />
            {connectionError}
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                YOUR LOCAL COMMAND CENTER
              </div>
              <h1>
                {view === 'board'
                  ? 'Agent workspace'
                  : view === 'agents'
                    ? 'Agent connections'
                    : view === 'reports'
                      ? 'Execution reports'
                      : viewNames[view]}
              </h1>
              <p>
                {view === 'board'
                  ? 'Queue tasks, inspect runs, and review agent output.'
                  : view === 'agents'
                    ? 'Manage connections, check availability, and give every agent a place.'
                    : view === 'reports'
                      ? 'Read what your agents found. Review the work. Decide what comes next.'
                      : view === 'terminal'
                        ? 'Connect securely to a remote shell without leaving your workspace.'
                        : 'Configure and inspect your agent workspace.'}
              </p>
            </div>
            <div className="heading-actions">
              {!demo && (
                <button className="button secondary" onClick={switchDemo}>
                  <Sparkles size={15} />
                  Explore demo
                </button>
              )}
              {(view === 'board' || view === 'reports') && !demo && (
                <button className="button secondary" onClick={() => void autoAssign()}>
                  <Activity size={15} />
                  Auto-assign
                </button>
              )}
              {view === 'agents' && !demo && state.agents.length > 0 && (
                <button className="button secondary" onClick={() => void probeAll()}>
                  <RefreshCw size={15} />
                  Check all agents
                </button>
              )}
              {view !== 'settings' && view !== 'github' && view !== 'schedules' && view !== 'documents' && view !== 'media' && view !== 'terminal' && (
                <button
                  className="button primary"
                  onClick={
                    view === 'board' || view === 'reports'
                      ? () => (demo ? sampleNotice() : setDialog({ kind: 'task' }))
                      : addAgent
                  }
                >
                  <Plus size={17} />
                  {view === 'board' || view === 'reports' ? 'New task' : 'Add agent'}
                </button>
              )}
            </div>
          </div>
          <section className="metrics" aria-label="Workspace overview">
            <Metric
              label="AGENTS REACHABLE"
              value={`${online}`}
              suffix={`/ ${state.agents.length}`}
              icon={<Radio size={18} />}
              note={state.agents.length ? 'Hermes availability' : 'Connect your first agent'}
              color="green"
            />
            <Metric
              label="IN PROGRESS"
              value={`${running.length}`}
              icon={<Activity size={19} />}
              note={running.length ? 'Agents are on the job' : 'Ready when you are'}
              color="blue"
            />
            <Metric
              label="NEEDS YOU"
              value={`${needs.length}`}
              icon={<Bell size={18} />}
              note={
                needs.length
                  ? `${needs.filter((i) => i.kind === 'question').length} question(s), ${review.length} to review`
                  : 'Nothing waiting on you'
              }
              color="amber"
            />
            <Metric
              label="COMPLETED"
              value={`${done.length}`}
              icon={<CheckCheck size={19} />}
              note="Reviewed and marked done"
              color="green"
            />
          </section>

          {view === 'board' && (
            <>
              <AttentionInbox items={needs} agents={state.agents} onOpen={openAttention} />
              <section className="agent-overview">
                <div className="section-heading">
                  <h2>
                    Your agents<span>{state.agents.length}</span>
                  </h2>
                  <button className="text-button" onClick={() => navigate('agents')}>
                    Manage agents
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className="agent-strip">
                  {state.agents.map((agent) => {
                    const current = state.tasks.find((t) => t.agentId === agent.id && t.status === 'running');
                    return (
                      <button
                        key={agent.id}
                        className={`agent-mini ${agentFilter === agent.id ? 'selected' : ''}`}
                        style={agentStyle(agent)}
                        aria-pressed={agentFilter === agent.id}
                        onClick={() => setAgentFilter(agentFilter === agent.id ? 'all' : agent.id)}
                      >
                        <div className="agent-mini-top">
                          <Avatar agent={agent} needsYou={waitingAgents.has(agent.id)} />
                          <div>
                            <strong>{agent.name}</strong>
                            <code>{agent.role ?? (agent.transport === 'local' ? 'This computer' : agent.host)}</code>
                          </div>
                          <AgentStatus agent={agent} />
                        </div>
                        <div className="agent-mini-bottom">
                          {waitingAgents.has(agent.id) ? (
                            <i className="waiting-dot" />
                          ) : agent.status === 'busy' ? (
                            <Activity size={13} />
                          ) : agent.status === 'online' ? (
                            <Check size={13} />
                          ) : (
                            <Clock3 size={13} />
                          )}
                          <span>
                            {waitingAgents.has(agent.id)
                              ? `Waiting on you: ${state.tasks.find((t) => t.agentId === agent.id && t.status === 'waiting')?.title}`
                              : (current?.title ??
                                (agent.status === 'online'
                                  ? 'Waiting for work'
                                  : agent.status === 'offline'
                                    ? `Last seen ${relativeTime(agent.lastSeen).toLowerCase()}`
                                    : 'Waiting for a connection check'))}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    className={`add-agent-card ${!state.agents.length ? 'first-agent' : ''}`}
                    onClick={addAgent}
                  >
                    <span className="add-agent-icon">
                      <Plus size={19} />
                    </span>
                    <div>
                      <strong>
                        {state.agents.length ? 'Add agent' : 'Your next teammate is one connection away'}
                      </strong>
                      {!state.agents.length && <span>Add a local Hermes agent to get started.</span>}
                    </div>
                    {!state.agents.length && <ArrowRight size={18} />}
                  </button>
                </div>
              </section>
              <section className="board-section">
                <div className="board-title-row">
                  <div className="board-title">
                    <h2>Task board</h2>
                    <span className="count-badge">{state.tasks.length}</span>
                    <span className="board-subtitle">The big picture, down to the details.</span>
                  </div>
                  <div className="view-switch" aria-label="Task layout">
                    <button
                      aria-label="Board view"
                      aria-pressed={layout === 'board'}
                      className={layout === 'board' ? 'active' : ''}
                      onClick={() => setLayout('board')}
                    >
                      <LayoutGrid size={15} />
                      <span>Board</span>
                    </button>
                    <button
                      aria-label="List view"
                      aria-pressed={layout === 'list'}
                      className={layout === 'list' ? 'active' : ''}
                      onClick={() => setLayout('list')}
                    >
                      <List size={16} />
                      <span>List</span>
                    </button>
                  </div>
                </div>
                <div className="board-toolbar">
                  <div className="board-filters">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search tasks"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search tasks..."
                      />
                      {search && (
                        <button aria-label="Clear search" onClick={() => setSearch('')}>
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <label className="filter-select">
                      <Bot size={15} />
                      <select
                        aria-label="Filter by agent"
                        value={agentFilter}
                        onChange={(event) => setAgentFilter(event.target.value)}
                      >
                        <option value="all">All agents</option>
                        <option value="unassigned">Unassigned</option>
                        {state.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="filter-select">
                      <Settings2 size={14} />
                      <select
                        aria-label="Filter by priority"
                        value={priorityFilter}
                        onChange={(event) => setPriorityFilter(event.target.value)}
                      >
                        <option value="all">All priorities</option>
                        <option value="high">High priority</option>
                        <option value="medium">Medium priority</option>
                        <option value="low">Low priority</option>
                      </select>
                    </label>
                    {(search || agentFilter !== 'all' || priorityFilter !== 'all') && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setSearch('');
                          setAgentFilter('all');
                          setPriorityFilter('all');
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <span className="board-hint">
                    {demo ? (
                      'Read-only preview'
                    ) : (
                      <>
                        <span className="live-dot" />
                        Live updates
                      </>
                    )}
                  </span>
                </div>
                {!state.tasks.length && !search && (
                  <div className="onboarding">
                    <div className="onboarding-art">
                      <FolderKanban size={28} />
                      <span>
                        <Sparkles size={13} />
                      </span>
                    </div>
                    <div>
                      <h3>Good work starts with a clear next step.</h3>
                      <p>Create your first task, assign an agent, and follow it from idea to done.</p>
                    </div>
                    <button className="button secondary" onClick={() => setDialog({ kind: 'task' })}>
                      Create a task
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {layout === 'board' ? (
                  <div className="kanban" aria-label="Kanban board">
                    {statuses.map((status) => {
                      const column = tasks.filter((task) => task.status === status);
                      return (
                        <section
                          className={`kanban-column column-${status} ${dragged && status !== 'running' ? 'drop-target' : ''}`}
                          key={status}
                          aria-label={`${statusNames[status]} column`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void moveTask(event, status)}
                        >
                          <header>
                            <span className={`column-status-icon ${status}`}>
                              {status === 'done' ? (
                                <Check size={12} />
                              ) : status === 'running' ? (
                                <Activity size={12} />
                              ) : status === 'waiting' ? (
                                <Bell size={11} />
                              ) : status === 'review' ? (
                                <Circle size={11} />
                              ) : status === 'blocked' ? (
                                <X size={11} />
                              ) : (
                                <Circle size={10} />
                              )}
                            </span>
                            <h3>{statusNames[status]}</h3>
                            <span className="column-count">{column.length}</span>
                            {status !== 'running' && status !== 'waiting' && (
                              <button
                                className="icon-button"
                                aria-label={`Add task to ${statusNames[status]}`}
                                onClick={() => (demo ? sampleNotice() : setDialog({ kind: 'task', status }))}
                              >
                                <Plus size={15} />
                              </button>
                            )}
                          </header>
                          <div className="column-cards">
                            {(() => {
                              const groups = new Map<string, typeof column>();
                              const ungrouped: typeof column = [];
                              for (const task of column) {
                                if (task.groupId) {
                                  const g = groups.get(task.groupId) ?? [];
                                  g.push(task);
                                  groups.set(task.groupId, g);
                                } else {
                                  ungrouped.push(task);
                                }
                              }
                              return (
                                <>
                                  {ungrouped.map((task) => (
                                    <TaskCard
                                      key={task.id}
                                      task={task}
                                      agent={state.agents.find((a) => a.id === task.agentId)}
                                      demo={demo}
                                      onOpen={() => setDialog({ kind: 'detail', id: task.id })}
                                      onDrag={setDragged}
                                    />
                                  ))}
                                  {[...groups.entries()].map(([groupId, groupTasks]) => (
                                    <details key={groupId} className="parallel-group" open>
                                      <summary>
                                        <Radio size={13} />
                                        Parallel run · {groupTasks.length} agents
                                      </summary>
                                      {groupTasks.map((task) => (
                                        <TaskCard
                                          key={task.id}
                                          task={task}
                                          agent={state.agents.find((a) => a.id === task.agentId)}
                                          demo={demo}
                                          onOpen={() => setDialog({ kind: 'detail', id: task.id })}
                                          onDrag={setDragged}
                                        />
                                      ))}
                                    </details>
                                  ))}
                                </>
                              );
                            })()}
                            {!column.length && (
                              <div className="column-empty">
                                {status === 'running'
                                  ? 'A place for work in motion'
                                  : status === 'waiting'
                                    ? 'No agent is waiting on you'
                                    : status === 'done'
                                      ? 'Good things will land here'
                                      : status === 'blocked'
                                        ? 'No roadblocks here'
                                        : status === 'review'
                                          ? 'Ready for a second look'
                                          : 'Room for what comes next'}
                              </div>
                            )}
                          </div>
                          {status !== 'running' && status !== 'waiting' && (
                            <button
                              className="column-add"
                              onClick={() => (demo ? sampleNotice() : setDialog({ kind: 'task', status }))}
                            >
                              <Plus size={14} />
                              Add task
                            </button>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="task-table">
                    <div className="task-table-heading">
                      <span>Task</span>
                      <span>Status</span>
                      <span>Agent</span>
                      <span>Priority</span>
                    </div>
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        style={agentStyle(state.agents.find((a) => a.id === task.agentId))}
                        onClick={() => setDialog({ kind: 'detail', id: task.id })}
                      >
                        <span>
                          <span className="task-ref">{task.id.slice(0, 8)}</span>
                          <strong>{task.title}</strong>
                        </span>
                        <span>
                          <span className={`status-pill ${task.status}`}>
                            <i />
                            {statusNames[task.status]}
                          </span>
                        </span>
                        <span>{state.agents.find((a) => a.id === task.agentId)?.name ?? 'Unassigned'}</span>
                        <span className={`priority ${task.priority}`}>
                          <i />
                          {task.priority}
                        </span>
                      </button>
                    ))}
                    {!tasks.length && (
                      <div className="empty-inline">
                        <Search size={25} />
                        <p>No tasks match this view.</p>
                      </div>
                    )}
                  </div>
                )}
              </section>
              <div className="workspace-footer">
                <span>
                  <ShieldCheck size={13} />
                  Local workspace. Real-time perspective.
                </span>
                <span>
                  {tasks.length} of {state.tasks.length} tasks<span className="footer-dot">/</span>
                  {demo ? 'Sample data only' : 'Drag cards to organize. Open a task to run it.'}
                </span>
              </div>
            </>
          )}

          {view === 'agents' && (
            <section>
              <div className="section-heading">
                <h2>
                  Agent directory<span>{state.agents.length}</span>
                </h2>
                <span className="subtle">Trusted hosts checked every 30 seconds while unlocked</span>
              </div>
              {!state.agents.length ? (
                <div className="large-empty">
                  <span className="empty-icon">
                    <Bot size={35} />
                  </span>
                  <h2>Build your own dream team.</h2>
                  <p>
                    Connect the Hermes agents on your machines.
                    <br />
                    Keep credentials secure and see their work in one place.
                  </p>
                  <button className="button primary" onClick={addAgent}>
                    <Plus size={16} />
                    Connect your first agent
                  </button>
                </div>
              ) : (
                <>
                  <div className="bulk-bar" role="toolbar" aria-label="Selected agents">
                    <strong>
                      {selectedAgents.length
                        ? `${selectedAgents.length} of ${state.agents.length} selected`
                        : 'Select agents to manage them together'}
                    </strong>
                    <button
                      className="button ghost small"
                      onClick={() =>
                        setSelectedAgents(
                          selectedAgents.length === state.agents.length ? [] : state.agents.map((a) => a.id),
                        )
                      }
                    >
                      {selectedAgents.length === state.agents.length ? 'Clear selection' : 'Select all'}
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!selectedAgents.length}
                      onClick={() => (demo ? sampleNotice() : setBulkModel(true))}
                    >
                      Set model…
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!selectedAgents.length}
                      onClick={() => void bulkClearModel()}
                    >
                      Use global model
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!selectedAgents.length}
                      onClick={() => void bulkProbe()}
                    >
                      <RefreshCw size={14} />
                      Check selected
                    </button>
                  </div>
                  <div className="agent-grid">
                    {state.agents.map((agent) => {
                      const resolved = effectiveModel(agent, state.defaults);
                      const tools = Object.entries(agent.tools ?? {});
                      return (
                        <article className="agent-card" key={agent.id} style={agentStyle(agent)}>
                          <div className="agent-card-header">
                            <label className="agent-select">
                              <input
                                type="checkbox"
                                aria-label={`Select ${agent.name}`}
                                checked={selectedAgents.includes(agent.id)}
                                onChange={(event) =>
                                  setSelectedAgents((current) =>
                                    event.target.checked
                                      ? [...current, agent.id]
                                      : current.filter((id) => id !== agent.id),
                                  )
                                }
                              />
                            </label>
                            <Avatar agent={agent} needsYou={waitingAgents.has(agent.id)} />
                            <div>
                              <h3>{agent.name}</h3>
                              <code>
                                {agent.transport === 'local'
                                  ? 'This computer'
                                  : `${agent.username}@${agent.host}`}
                              </code>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Configure ${agent.name}`}
                              onClick={() =>
                                demo
                                  ? sampleNotice()
                                  : state.vault.unlocked
                                    ? setDialog({ kind: 'agent', agent })
                                    : setDialog({ kind: 'vault' })
                              }
                            >
                              <MoreHorizontal size={20} />
                            </button>
                          </div>
                          <div className="agent-card-status">
                            <AgentStatus agent={agent} />
                            <span>
                              {agent.lastSeen
                                ? `Checked ${relativeTime(agent.lastSeen).toLowerCase()}`
                                : 'Not checked yet'}
                            </span>
                          </div>
                          <dl>
                            <div>
                              <dt>Profile</dt>
                              <dd>{agent.profile || 'Installation default'}</dd>
                            </div>
                            <div>
                              <dt>Model</dt>
                              <dd title={resolved.model}>
                                {resolved.model || 'Hermes default'}
                                {resolved.source !== 'default' && (
                                  <span className="model-source">
                                    {resolved.source === 'agent' ? 'override' : 'global'}
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Provider</dt>
                              <dd>{resolved.provider || 'Hermes default'}</dd>
                            </div>
                            <div>
                              <dt>Coding tools</dt>
                              <dd className="tool-list">
                                {tools.length
                                  ? tools.map(([tool, info]) => (
                                      <span
                                        className="runner-chip"
                                        key={tool}
                                        title={`${info.path} · ${info.version}`}
                                      >
                                        <Code2 size={11} />
                                        {runnerNames[tool as keyof typeof runnerNames]}
                                      </span>
                                    ))
                                  : agent.lastSeen
                                    ? 'None found'
                                    : 'Check to detect'}
                              </dd>
                            </div>
                            <div>
                              <dt>Connection</dt>
                              <dd>{agent.transport === 'local' ? 'Local process' : `SSH · ${agent.port}`}</dd>
                            </div>
                            <div>
                              <dt>Credentials</dt>
                              <dd>
                                <KeyIcon />
                                {demo
                                  ? 'Sample only'
                                  : agent.transport === 'local'
                                    ? 'Current OS user'
                                    : agent.authType === 'privateKey'
                                      ? 'Private key'
                                      : 'Password'}
                              </dd>
                            </div>
                            <div>
                              <dt>Host key</dt>
                              <dd className={agent.fingerprint ? 'verified-text' : ''}>
                                {agent.transport === 'local'
                                  ? 'Not applicable'
                                  : agent.fingerprint
                                    ? 'Verified'
                                    : 'Not verified'}
                              </dd>
                            </div>
                            <div>
                              <dt>Working directory</dt>
                              <dd title={agent.workdir}>{agent.workdir || 'Installation default'}</dd>
                            </div>
                          </dl>
                          {agent.lastError && <p className="agent-error">{agent.lastError}</p>}
                          <footer>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                demo
                                  ? sampleNotice()
                                  : state.vault.unlocked
                                    ? setDialog({ kind: 'agent', agent })
                                    : setDialog({ kind: 'vault' })
                              }
                            >
                              Change model
                            </button>
                            <button
                              className="button secondary small"
                              disabled={checking.includes(agent.id)}
                              onClick={() => void probe(agent)}
                            >
                              <RefreshCw size={14} className={checking.includes(agent.id) ? 'spin' : ''} />
                              {checking.includes(agent.id) ? 'Checking...' : 'Check connection'}
                            </button>
                            <button
                              className="button ghost small"
                              disabled={agent.transport === 'local'}
                              title={
                                agent.transport === 'local' ? 'Interactive shells require SSH' : undefined
                              }
                              onClick={() => openTerminal(agent)}
                            >
                              <Terminal size={15} />
                              Shell
                              <ArrowUpRight size={13} />
                            </button>
                          </footer>
                        </article>
                      );
                    })}
                    <button className="add-agent-large" onClick={addAgent}>
                      <Plus size={25} />
                      <strong>Make the team a little bigger</strong>
                      <span>Add another agent</span>
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {view === 'reports' && (
            <div className="reports-layout">
              <section>
                <div className="section-heading">
                  <h2>
                    Task reports<span>{state.tasks.filter((task) => task.report || task.error).length}</span>
                  </h2>
                  <span className="subtle">Latest updates first</span>
                </div>
                <div className="reports-list">
                  {state.tasks
                    .filter((task) => task.report || task.error)
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .map((task) => (
                      <button
                        className="report-card"
                        style={agentStyle(state.agents.find((a) => a.id === task.agentId))}
                        key={task.id}
                        onClick={() => setDialog({ kind: 'detail', id: task.id })}
                      >
                        <div className="report-card-top">
                          <span className={`status-pill ${task.status}`}>
                            <i />
                            {statusNames[task.status]}
                          </span>
                          <time>{relativeTime(task.updatedAt)}</time>
                        </div>
                        <h3>{task.title}</h3>
                        <p>{task.report || task.error}</p>
                        <footer>
                          <span>
                            <Avatar agent={state.agents.find((a) => a.id === task.agentId)} small />
                            {state.agents.find((a) => a.id === task.agentId)?.name ?? 'Unassigned'}
                          </span>
                          <span>
                            Read report
                            <ArrowUpRight size={15} />
                          </span>
                        </footer>
                      </button>
                    ))}
                  {!state.tasks.some((task) => task.report || task.error) && (
                    <div className="large-empty">
                      <span className="empty-icon">
                        <FileText size={31} />
                      </span>
                      <h2>Less guessing. More knowing.</h2>
                      <p>
                        Agent results and failure details appear here after a task runs.
                        <br />
                        Every successful run stops in Review for your approval.
                      </p>
                      <button className="button secondary" onClick={() => navigate('board')}>
                        Back to the board
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </section>
              <aside className="activity-panel">
                <div className="section-heading">
                  <h2>
                    <Activity size={17} />
                    Workspace activity
                  </h2>
                </div>
                {state.activity.slice(0, 20).map((item) => (
                  <div key={item.id} className="activity-item">
                    <span className={`activity-icon ${item.kind}`}>
                      {item.kind === 'agent' ? (
                        <Bot size={14} />
                      ) : item.kind === 'task' ? (
                        <Check size={14} />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                    </span>
                    <div>
                      <p>{item.message}</p>
                      <time>{relativeTime(item.createdAt)}</time>
                    </div>
                  </div>
                ))}
                {!state.activity.length && (
                  <p className="activity-empty">
                    A quiet start. Updates will appear as your workspace comes to life.
                  </p>
                )}
              </aside>
            </div>
          )}
          {['schedules', 'documents', 'media', 'models'].includes(view) &&
            (demo ? (
              <p>Exit demo to manage schedules, files, and models.</p>
            ) : (
              <>
                {view === 'schedules' && (
                  <Schedules
                    request={request}
                    agents={state.agents}
                    schedules={state.schedules}
                    onTask={(id) => setDialog({ kind: 'detail', id })}
                  />
                )}
                {(view === 'documents' || view === 'media') && (
                  <Library
                    request={request}
                    agents={state.agents}
                    tasks={state.tasks}
                    media={view === 'media'}
                    onReport={(id) => setDialog({ kind: 'detail', id })}
                  />
                )}
                {view === 'github' && (
                  <GitHub
                    request={request}
                    agents={state.agents}
                    tasks={state.tasks}
                    github={state.github}
                    githubSyncs={state.githubSyncs}
                    vaultUnlocked={state.vault.unlocked}
                    onVaultOpen={() => setDialog({ kind: 'vault' })}
                    demo={demo}
                  />
                )}
                {view === 'settings' && (
                  <Settings
                    request={request}
                    state={state}
                    agents={state.agents}
                    sshKeys={state.sshKeys}
                    defaults={state.defaults}
                    name={userName}
                    theme={theme}
                    onName={saveName}
                    onTheme={saveTheme}
                    onVaultChange={() => {}}
                  />
                )}
              </>
            ))}
          {view === 'terminal' && (
            <>
              <Suspense fallback={<div className="loading-panel">Loading terminal...</div>}>
                <TerminalPanel
                  key={`${demo}-${terminalAgent ?? 'default'}`}
                  agents={state.agents.filter((agent) => agent.transport !== 'local')}
                  token={state.csrfToken}
                  unlocked={state.vault.unlocked}
                  demo={demo}
                  initialAgentId={terminalAgent}
                  onUnlock={() => setDialog({ kind: 'vault' })}
                  onCheck={(agent) => void probe(agent)}
                />
              </Suspense>
              <div className="terminal-notes">
                <div>
                  <ShieldCheck size={18} />
                  <p>
                    <strong>Your connection, protected.</strong>Credentials are decrypted only by the local
                    server. They are never returned to the browser.
                  </p>
                </div>
                <div>
                  <Terminal size={18} />
                  <p>
                    <strong>A real shell, not a simulation.</strong>Commands run with the SSH user's
                    permissions. Task output lives in each task's Live output tab.
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {dialog?.kind === 'vault' && (
        <VaultModal
          state={realState ?? blank}
          request={request}
          onClose={() => setDialog(null)}
          onSuccess={() => {
            setDialog(dialog.next === 'agent' ? { kind: 'agent' } : null);
            setToast({ message: 'Vault unlocked. Your credentials are ready when you are.' });
          }}
        />
      )}
      {dialog?.kind === 'agent' && (
        <AgentModal
          agent={dialog.agent}
          agents={state.agents}
          sshKeys={state.sshKeys}
          request={request}
          onClose={() => setDialog(null)}
          onSaved={(agent) => {
            setDialog(null);
            setToast({ message: `${agent.name} saved. Check the connection before running tasks.` });
            navigate('agents');
          }}
          onDeleted={() => {
            setDialog(null);
            setAgentFilter('all');
            setToast({ message: 'Agent removed. Task history has been kept.' });
          }}
        />
      )}
      {dialog?.kind === 'task' && (
        <TaskForm
          agents={state.agents}
          status={dialog.status}
          request={request}
          onClose={() => setDialog(null)}
          onSaved={(task) => {
            setDialog({ kind: 'detail', id: task.id });
            setToast({ message: 'Task created. Run it when you are ready.' });
          }}
        />
      )}
      {selectedTask && (
        <TaskDetail
          key={selectedTask.id}
          task={selectedTask}
          agents={state.agents}
          request={request}
          demo={demo}
          unlocked={state.vault.unlocked}
          onClose={() => setDialog(null)}
          onUnlock={() => setDialog({ kind: 'vault' })}
        />
      )}
      {bulkModel && (
        <BulkModelModal
          agents={state.agents.filter((agent) => selectedAgents.includes(agent.id))}
          request={request}
          onClose={() => setBulkModel(false)}
          onSaved={(count) => {
            setBulkModel(false);
            setToast({ message: `Model updated on ${count} agent(s). It applies to their next runs.` });
          }}
        />
      )}
      {dialog?.kind === 'trust' && (
        <TrustModal
          agent={dialog.agent}
          fingerprint={dialog.fingerprint}
          onClose={() => setDialog(null)}
          onTrust={async () => {
            await request(`/agents/${dialog.agent.id}/trust`, 'POST', { fingerprint: dialog.fingerprint });
            setDialog(null);
            await probe(dialog.agent);
          }}
        />
      )}
      {dialog?.kind === 'help' && (
        <Modal
          title="A calmer way to manage your agents"
          subtitle="A quick guide to your local workspace."
          onClose={() => setDialog(null)}
        >
          <div className="help-content">
            {[
              {
                n: '01',
                title: 'Set up your vault',
                text: 'Choose a passphrase of at least 12 characters. It encrypts your saved SSH passwords and private keys. The passphrase is not saved and cannot be recovered.',
              },
              {
                n: '02',
                title: 'Connect and verify an agent',
                text: 'Add an SSH host, username, and credentials. Check the connection, independently verify its host-key fingerprint, then trust it. Use an absolute Hermes executable path if needed.',
              },
              {
                n: '03',
                title: 'Give the work a place',
                text: 'Create tasks and move them through the board. Assign an agent, open the task, and explicitly select Run task. Only that action starts Hermes, not moving a card.',
              },
              {
                n: '04',
                title: 'Follow along. Have the final say.',
                text: 'Watch Live output inside a task, then read its report. Successful runs go to Review. Check the actual outcome before marking them Done.',
              },
              {
                n: '05',
                title: 'Answer when an agent needs you',
                text: 'If a run ends with a question or a denied permission, the task moves to Needs you and the agent glows amber. Reply from the task to continue the same session. Turn on desktop alerts in the sidebar to hear about it.',
              },
            ].map((item) => (
              <div className="help-step" key={item.n}>
                <span>{item.n}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
            <div className="callout">
              <ShieldCheck size={18} />
              <p>
                Local-only, single-user application. Status reflects SSH/Hermes reachability and tasks
                launched here, not every process already running on a host. Task data and logs are stored
                unencrypted. Closing the manager can leave remote work in an unknown state; inspect the host
                before retrying. One SSH operation per agent at a time.
              </p>
            </div>
            <p className="field-hint">
              Requires Node.js 24+ here, and a recent Hermes version with one-shot JSON streaming on each
              POSIX SSH host. See README.md for setup, storage, and security details.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          {toast.error ? <Radio size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  icon,
  note,
  color,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  note: string;
  color: string;
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${color}`}>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <span>{suffix}</span>
      </div>
      <div className="metric-note">
        <span className={`metric-note-dot ${color}`} />
        {note}
      </div>
    </article>
  );
}
function KeyIcon() {
  return <LockKeyhole size={11} />;
}
function TaskCard({
  task,
  agent,
  demo,
  onOpen,
  onDrag,
}: {
  task: Task;
  agent?: Agent;
  demo: boolean;
  onOpen: () => void;
  onDrag: (id: string | null) => void;
}) {
  return (
    <button
      className={`task-card task-${task.status}`}
      style={agentStyle(agent)}
      draggable={!demo && task.status !== 'running'}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        onDrag(task.id);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={onOpen}
      aria-label={`Open task: ${task.title}`}
    >
      <div className="task-card-top">
        <span className="task-ref">
          {demo ? `HM-${task.id.split('-')[1]}` : `HM-${task.id.slice(0, 5).toUpperCase()}`}
        </span>
        <span className={`priority ${task.priority}`}>
          {task.priority === 'high' ? (
            <ArrowUpRight size={12} />
          ) : task.priority === 'low' ? (
            <ArrowDown size={12} />
          ) : (
            <span className="medium-lines">=</span>
          )}
          {task.priority}
        </span>
      </div>
      <h4>{task.title}</h4>
      <p>
        {task.status === 'waiting' && task.waitingReason
          ? task.waitingReason
          : task.description || 'Open to add instructions and context.'}
      </p>
      {(task.runner && task.runner !== 'hermes') || task.scheduleId ? (
        <div className="tool-list" style={{ marginBottom: 10 }}>
          {task.runner && task.runner !== 'hermes' && (
            <span className="runner-chip">
              <Code2 size={11} />
              {runnerNames[task.runner]}
            </span>
          )}
          {task.scheduleId && (
            <span className="runner-chip">
              <CalendarClock size={11} />
              Scheduled
            </span>
          )}
        </div>
      ) : null}
      {task.status === 'waiting' && (
        <span className="task-tag waiting">
          <Bell size={11} />
          Waiting on you
        </span>
      )}
      {task.status === 'running' && (
        <div className="task-progress">
          <span>
            <Activity size={12} />
            Agent is working
          </span>
          <span className="progress-bars">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {task.status === 'review' && (
        <span className="task-tag">
          <FileText size={11} />
          {task.report ? 'Report ready' : 'Awaiting review'}
        </span>
      )}
      {task.status === 'blocked' && (
        <span className="task-tag blocked">
          <Circle size={10} />
          Needs attention
        </span>
      )}
      <footer>
        <span className="task-assignee">
          <Avatar agent={agent} small needsYou={task.status === 'waiting'} />
          <span>{agent?.name ?? 'Unassigned'}</span>
        </span>
        <span className="task-age">
          <Clock3 size={11} />
          {relativeTime(task.updatedAt)}
        </span>
      </footer>
    </button>
  );
}
