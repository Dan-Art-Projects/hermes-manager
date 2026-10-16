export type AgentStatus = 'unknown' | 'online' | 'offline' | 'busy';

export const agentRoles = [
  { value: 'developer', label: 'Developer' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'writer', label: 'Writer' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'researcher', label: 'Researcher' },
  { value: 'operations', label: 'Operations' },
  { value: 'design', label: 'Design' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'devops', label: 'DevOps' },
  { value: 'security', label: 'Security' },
  { value: 'support', label: 'Support' },
] as const;
export type AgentRole = (typeof agentRoles)[number]['value'];

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  source?: string;
  installedAt: string;
}
export type TaskStatus = 'backlog' | 'ready' | 'running' | 'waiting' | 'review' | 'done' | 'blocked' | 'archived';
export type Priority = 'low' | 'medium' | 'high';
export type Runner = 'hermes' | 'opencode' | 'codex' | 'claude';
export type CodingTool = Exclude<Runner, 'hermes'>;
export const codingTools: CodingTool[] = ['claude', 'codex', 'opencode'];
export const runnerNames: Record<Runner, string> = {
  hermes: 'Hermes',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};
export const agentColors = [
  'jade',
  'sky',
  'amber',
  'rose',
  'violet',
  'lime',
  'coral',
  'teal',
  'gold',
  'orchid',
  'azure',
  'sand',
] as const;
export type AgentColor = (typeof agentColors)[number];

export interface ToolInfo {
  path: string;
  version: string;
}

export interface Agent {
  model?: string;
  provider?: string;
  transport?: 'ssh' | 'local';
  id: string;
  name: string;
  color?: AgentColor;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  hermesPath: string;
  workdir: string;
  profile: string;
  fingerprint?: string;
  /** A host key was observed but not yet trusted. Computed for snapshots, never stored. */
  hostKeyPending?: boolean;
  /** Hermes accepts --resume for follow-up replies (detected by the connection check). */
  resume?: boolean;
  /** Coding CLIs found by the last connection check. */
  tools?: Partial<Record<CodingTool, ToolInfo>>;
  /** Explicit coding CLI paths; empty entries are auto-detected. */
  toolPaths?: Partial<Record<CodingTool, string>>;
  /** Per-agent coding CLI model overrides; empty entries follow the global default. */
  toolModels?: Partial<Record<CodingTool, string>>;
  role?: string;
  capabilities?: string[];
  systemPrompt?: string;
  skills?: AgentSkill[];
  status: AgentStatus;
  lastSeen?: string;
  lastError?: string;
  version?: string;
  createdAt: string;
  hasCredential: boolean;
}

export interface Turn {
  role: 'user' | 'agent';
  text: string;
  at: string;
}

export interface Task {
  scheduleId?: string;
  id: string;
  title: string;
  description: string;
  agentId: string | null;
  runner?: Runner;
  /** Optional working directory on the agent's machine; overrides the agent's default. */
  workdir?: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  report?: string;
  sessionId?: string;
  exitCode?: number;
  error?: string;
  waitingReason?: string;
  tags?: string[];
  /** Links tasks that were broadcast together as a parallel group. */
  groupId?: string;
  /** Remaining agentIds to run sequentially after the current agent finishes. */
  chain?: string[];
  /** 1-based index of the current step in a sequential chain. */
  chainStep?: number;
  /** GitHub URL of the source issue/PR/project item; used for deduplication on re-sync. */
  githubRef?: string;
  /** Controls whether a schedule chain step fires always or only when the task produced output. */
  chainTrigger?: 'always' | 'on-output';
  turns?: Turn[];
}

export interface ScheduleChainStep {
  agentId: string;
  instruction?: string;
  trigger: 'always' | 'on-output';
}

export interface Schedule {
  id: string;
  title: string;
  description: string;
  agentId: string;
  runner?: Runner;
  nextRun: string;
  intervalMinutes: number;
  enabled: boolean;
  lastTaskId?: string;
  lastError?: string;
  chain?: ScheduleChainStep[];
}

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  private: boolean;
  openIssuesCount: number;
  language: string | null;
  updatedAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  url: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  isPullRequest: boolean;
}

export interface GitHubProjectV2 {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  owner: string;
}

export interface GitHubProjectItem {
  id: string;
  title: string;
  body?: string;
  status?: string;
  url?: string;
  number?: number;
}

export interface GitHubSync {
  id: string;
  name: string;
  repoFullName?: string;
  projectNodeId?: string;
  type: 'issues' | 'prs' | 'project';
  agentId: string;
  runner?: Runner;
  enabled: boolean;
  intervalMinutes: number;
  nextRun: string;
  lastSyncedAt?: string;
  lastError?: string;
  labelFilter?: string[];
  stateFilter?: 'open' | 'closed' | 'all';
}

export interface SshKey {
  id: string;
  name: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  name: string;
  taskId: string | null;
  kind: 'document' | 'image' | 'video' | 'audio';
  mime: string;
  size: number;
  createdAt: string;
}

export interface CatalogModel {
  id: string;
  name: string;
  input: number | null;
  output: number | null;
  free: boolean;
}

export interface ModelDefaults {
  model: string;
  provider: string;
  tools: Partial<Record<CodingTool, string>>;
}

export interface TaskLog {
  id: number;
  taskId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  message: string;
  createdAt: string;
  kind: 'agent' | 'task' | 'system';
}

export type BrainEntryType = 'note' | 'link' | 'snippet' | 'insight' | 'task-summary';

export interface BrainEntry {
  id: string;
  type: BrainEntryType;
  title: string;
  content: string;
  url?: string;
  tags: string[];
  taskId?: string;
  agentId?: string;
  source: 'manual' | 'ai-extracted';
  createdAt: string;
  updatedAt: string;
}

export interface AppSnapshot {
  agents: Agent[];
  tasks: Task[];
  schedules: Schedule[];
  sshKeys: SshKey[];
  defaults: ModelDefaults;
  vault: { configured: boolean; unlocked: boolean };
  activity: Activity[];
  csrfToken: string;
  github: { configured: boolean };
  githubSyncs: GitHubSync[];
  openaiConfigured: boolean;
  huggingfaceConfigured: boolean;
  brainEntries: BrainEntry[];
}

export interface AgentInput {
  model?: string;
  provider?: string;
  transport?: 'ssh' | 'local';
  name: string;
  color?: AgentColor;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  hermesPath: string;
  workdir: string;
  profile: string;
  role?: string;
  capabilities?: string[];
  systemPrompt?: string;
  toolPaths?: Partial<Record<CodingTool, string>>;
  toolModels?: Partial<Record<CodingTool, string>>;
  credentials?: { password?: string; privateKey?: string; passphrase?: string };
  sshKeyId?: string;
}

export type ServerEvent = { type: 'state'; data: AppSnapshot } | { type: 'log'; data: TaskLog };

/** Agent override wins as a pair; otherwise the global default; otherwise the CLI's own default. */
export function effectiveModel(
  agent: Pick<Agent, 'model' | 'provider'>,
  defaults: Pick<ModelDefaults, 'model' | 'provider'>,
): { model: string; provider: string; source: 'agent' | 'global' | 'default' } {
  if (agent.model || agent.provider)
    return { model: agent.model ?? '', provider: agent.provider ?? '', source: 'agent' };
  if (defaults.model || defaults.provider)
    return { model: defaults.model, provider: defaults.provider, source: 'global' };
  return { model: '', provider: '', source: 'default' };
}

export function effectiveToolModel(
  agent: Pick<Agent, 'toolModels'>,
  defaults: Pick<ModelDefaults, 'tools'>,
  tool: CodingTool,
): string {
  return agent.toolModels?.[tool] || defaults.tools?.[tool] || '';
}
