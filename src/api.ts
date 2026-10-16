import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Agent, AppSnapshot, ServerEvent } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public fingerprint?: string,
  ) {
    super(message);
  }
}

export function socketUrl(path: string, token: string) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** Fills fields an older or mismatched server may omit, so a stale backend cannot blank the UI. */
function normalize(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents ?? [],
    tasks: snapshot.tasks ?? [],
    activity: snapshot.activity ?? [],
    schedules: snapshot.schedules ?? [],
    sshKeys: snapshot.sshKeys ?? [],
    defaults: {
      model: snapshot.defaults?.model ?? '',
      provider: snapshot.defaults?.provider ?? '',
      tools: snapshot.defaults?.tools ?? {},
    },
    github: snapshot.github ?? { configured: false },
    githubSyncs: snapshot.githubSyncs ?? [],
    openaiConfigured: snapshot.openaiConfigured ?? false,
    huggingfaceConfigured: snapshot.huggingfaceConfigured ?? false,
    brainEntries: snapshot.brainEntries ?? [],
  };
}

export function useManager() {
  const [state, setState] = useState<AppSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  // An older server process omits newer fields; its API is missing routes the UI relies on.
  const [outdated, setOutdated] = useState(false);
  const accept = (snapshot: AppSnapshot) => {
    setOutdated(snapshot.schedules === undefined || snapshot.defaults === undefined);
    setState(normalize(snapshot));
  };
  const token = useRef('');
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        const response = await fetch('/api/state');
        if (!response.ok) throw new Error('The local manager is unavailable.');
        const snapshot: AppSnapshot = await response.json();
        if (stopped) return;
        token.current = snapshot.csrfToken;
        accept(snapshot);
        setError('');
        socket = new WebSocket(socketUrl('/ws/events', token.current));
        socket.onopen = () => {
          if (!stopped) {
            setConnected(true);
            window.dispatchEvent(new Event('manager:connected'));
          }
        };
        socket.onmessage = (event) => {
          if (stopped) return;
          const message: ServerEvent = JSON.parse(event.data);
          if (message.type === 'state') accept(message.data);
          else window.dispatchEvent(new CustomEvent('manager:log', { detail: message.data }));
        };
        socket.onclose = () => {
          if (!stopped) {
            setConnected(false);
            timer = setTimeout(connect, 2000);
          }
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (!stopped) {
          setConnected(false);
          setError('Cannot reach the local manager. Start the server with npm run dev or npm start.');
          timer = setTimeout(connect, 3000);
        }
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  async function request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Manager-Token': token.current },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new ApiError(value.error || 'Request failed.', value.code, value.fingerprint);
    if (method !== 'GET') {
      try {
        const fresh = await fetch('/api/state');
        if (fresh.ok) accept(await fresh.json());
      } catch {
        // The mutation already succeeded. A refresh failure must not invite a duplicate execution.
        setError('Your change was saved, but the workspace could not refresh. Reconnecting to the manager.');
      }
    }
    return value as T;
  }
  return { state, connected, error, outdated, request };
}

export type Request = ReturnType<typeof useManager>['request'];
export const statusNames = {
  backlog: 'Backlog',
  ready: 'Ready',
  running: 'In progress',
  waiting: 'Needs you',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
  archived: 'Archived',
} as const;
export const statuses = ['backlog', 'ready', 'running', 'waiting', 'review', 'done', 'blocked'] as const satisfies (keyof typeof statusNames)[];

export interface AttentionItem {
  key: string;
  kind: 'question' | 'review' | 'blocked' | 'setup';
  title: string;
  detail: string;
  agentId?: string;
  taskId?: string;
  target: 'task' | 'agents' | 'schedules' | 'vault';
}

/** Everything that is waiting on the human, most urgent first. */
export function attention(state: AppSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  const agentName = (id: string | null) => state.agents.find((a) => a.id === id)?.name ?? 'Unassigned';
  for (const task of state.tasks) {
    if (task.status === 'waiting')
      items.push({
        key: `question:${task.id}:${task.updatedAt}`,
        kind: 'question',
        title: task.title,
        detail: `${agentName(task.agentId)} asks: ${task.waitingReason ?? 'Your input is needed.'}`,
        agentId: task.agentId ?? undefined,
        taskId: task.id,
        target: 'task',
      });
    else if (task.status === 'blocked')
      items.push({
        key: `blocked:${task.id}:${task.updatedAt}`,
        kind: 'blocked',
        title: task.title,
        detail: task.error ?? 'Blocked. Open the task to decide what happens next.',
        agentId: task.agentId ?? undefined,
        taskId: task.id,
        target: 'task',
      });
    else if (task.status === 'review')
      items.push({
        key: `review:${task.id}:${task.updatedAt}`,
        kind: 'review',
        title: task.title,
        detail: `${agentName(task.agentId)} finished. Review the result.`,
        agentId: task.agentId ?? undefined,
        taskId: task.id,
        target: 'task',
      });
  }
  if (state.vault.configured && !state.vault.unlocked && state.agents.length)
    items.push({
      key: 'vault',
      kind: 'setup',
      title: 'Vault is locked',
      detail: 'Agents and schedules cannot run until you unlock it.',
      target: 'vault',
    });
  for (const agent of state.agents) {
    if (agent.hostKeyPending)
      items.push({
        key: `hostkey:${agent.id}`,
        kind: 'setup',
        title: `Verify ${agent.name}'s host key`,
        detail: 'A new SSH host key was seen. Check the connection to review and trust it.',
        agentId: agent.id,
        target: 'agents',
      });
    else if (agent.status === 'offline')
      items.push({
        key: `offline:${agent.id}:${agent.lastError ?? ''}`,
        kind: 'setup',
        title: `${agent.name} is offline`,
        detail: agent.lastError ?? 'The last connection check failed.',
        agentId: agent.id,
        target: 'agents',
      });
  }
  for (const schedule of state.schedules ?? [])
    if (schedule.lastError)
      items.push({
        key: `schedule:${schedule.id}:${schedule.lastError}`,
        kind: 'setup',
        title: `Schedule "${schedule.title}" is stuck`,
        detail: schedule.lastError,
        agentId: schedule.agentId,
        target: 'schedules',
      });
  const order = { question: 0, blocked: 1, setup: 2, review: 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Inline style that exposes an agent's colour to CSS as --agent. */
export function agentStyle(agent?: Pick<Agent, 'color'>): CSSProperties | undefined {
  return agent?.color ? ({ '--agent': `var(--agent-${agent.color})` } as CSSProperties) : undefined;
}
export function relativeTime(value?: string) {
  if (!value) return 'Not checked yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
