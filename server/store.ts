import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Activity, Agent, BrainEntry, GitHubSync, Role, Skill, SshKey, Task, TaskLog } from '../shared/types.ts';
import type { Sealed, VaultRecord } from './vault.ts';

export const LOG_LIMIT = 2000;
export const LOG_TEXT_LIMIT = 8192;

export class Store {
  private db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, 'manager.sqlite');
    this.db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      // A second manager must not "recover" tasks that this process is still running.
      this.db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, data TEXT NOT NULL, credential TEXT NOT NULL, capable INTEGER);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        stream TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS logs_task_id ON logs(task_id, id);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ssh_keys (id TEXT PRIMARY KEY, data TEXT NOT NULL, key_data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS brain_entries (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS brain_entries_ts ON brain_entries(created_at DESC);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS skills_ts ON skills(created_at DESC);
      CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS roles_ts ON roles(created_at DESC);
      PRAGMA user_version = 1;
      `);
      for (const agent of this.agents()) {
        this.saveAgent({ ...agent, status: 'unknown' });
      }
      for (const task of this.tasks()) {
        if (task.status !== 'running') continue;
        const error =
          'Manager restarted while this task was running. Remote outcome is unknown; check the host before retrying.';
        this.saveTask({ ...task, status: 'blocked', error, updatedAt: new Date().toISOString() });
        this.addLog(task.id, 'system', error);
        this.addActivity('task', `Task "${task.title}" needs review after restart.`);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  readVault(): VaultRecord | undefined {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('vault');
    return row ? (JSON.parse(row.value as string) as VaultRecord) : undefined;
  }

  setting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
    return row ? (JSON.parse(row.value as string) as T) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  writeVault(value: VaultRecord): void {
    this.db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)').run('vault', JSON.stringify(value));
  }

  agents(): Agent[] {
    return this.db
      .prepare('SELECT data FROM agents ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.data as string) as Agent);
  }

  agent(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT data FROM agents WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data as string) as Agent) : undefined;
  }

  credential(id: string): Sealed {
    const row = this.db.prepare('SELECT credential FROM agents WHERE id = ?').get(id);
    if (!row) throw new Error('Missing agent');
    return JSON.parse(row.credential as string) as Sealed;
  }

  saveAgent(agent: Agent, credential?: Sealed): void {
    if (credential) {
      this.db
        .prepare(
          `INSERT INTO agents(id, data, credential) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, credential = excluded.credential`,
        )
        .run(agent.id, JSON.stringify(agent), JSON.stringify(credential));
    } else {
      this.db.prepare('UPDATE agents SET data = ? WHERE id = ?').run(JSON.stringify(agent), agent.id);
    }
  }

  capability(id: string): boolean {
    return this.db.prepare('SELECT capable FROM agents WHERE id = ?').get(id)?.capable === 1;
  }

  setCapability(id: string, value: boolean): void {
    this.db.prepare('UPDATE agents SET capable = ? WHERE id = ?').run(value ? 1 : 0, id);
  }

  deleteAgent(id: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const task of this.tasks().filter((task) => task.agentId === id)) {
        this.saveTask({ ...task, agentId: null, updatedAt: new Date().toISOString() });
      }
      this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  tasks(): Task[] {
    return this.db
      .prepare('SELECT data FROM tasks ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(row.data as string) as Task);
  }

  task(id: string): Task | undefined {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data as string) as Task) : undefined;
  }

  saveTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks(id, agent_id, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, data = excluded.data`,
      )
      .run(task.id, task.agentId, JSON.stringify(task));
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  addLog(taskId: string, stream: TaskLog['stream'], text: string): TaskLog {
    const createdAt = new Date().toISOString();
    text =
      text.length > LOG_TEXT_LIMIT ? `${text.slice(0, LOG_TEXT_LIMIT - 24)}\n[log entry truncated]` : text;
    const result = this.db
      .prepare('INSERT INTO logs(task_id, stream, text, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, stream, text, createdAt);
    this.db
      .prepare(
        `DELETE FROM logs WHERE task_id = ? AND id <= COALESCE(
      (SELECT id FROM logs WHERE task_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`,
      )
      .run(taskId, taskId, LOG_LIMIT);
    this.db
      .prepare(
        `DELETE FROM logs WHERE id <= COALESCE(
      (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET 20000), 0)`,
      )
      .run();
    return { id: Number(result.lastInsertRowid), taskId, stream, text, createdAt };
  }

  logs(taskId: string): TaskLog[] {
    return this.db
      .prepare(
        `SELECT id, task_id AS taskId, stream, text, created_at AS createdAt FROM logs
      WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(taskId, LOG_LIMIT)
      .reverse() as unknown as TaskLog[];
  }

  addActivity(kind: Activity['kind'], message: string): void {
    const activity: Activity = {
      id: randomUUID(),
      kind,
      message: message.slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare('INSERT INTO activity(id, data) VALUES (?, ?)')
      .run(activity.id, JSON.stringify(activity));
    this.db
      .prepare(
        'DELETE FROM activity WHERE rowid NOT IN (SELECT rowid FROM activity ORDER BY rowid DESC LIMIT 200)',
      )
      .run();
  }

  sshKeys(): SshKey[] {
    return this.db
      .prepare('SELECT data FROM ssh_keys ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.data as string) as SshKey);
  }

  sshKeySealed(id: string): Sealed | undefined {
    const row = this.db.prepare('SELECT key_data FROM ssh_keys WHERE id = ?').get(id);
    return row ? (JSON.parse(row.key_data as string) as Sealed) : undefined;
  }

  saveSshKey(key: SshKey, sealed: Sealed): void {
    this.db
      .prepare('INSERT INTO ssh_keys(id, data, key_data) VALUES (?, ?, ?)')
      .run(key.id, JSON.stringify(key), JSON.stringify(sealed));
  }

  deleteSshKey(id: string): void {
    this.db.prepare('DELETE FROM ssh_keys WHERE id = ?').run(id);
  }

  activity(): Activity[] {
    return this.db
      .prepare('SELECT data FROM activity ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(row.data as string) as Activity);
  }

  githubTokenSealed(): Sealed | undefined {
    const raw = this.setting<Sealed | null>('github-pat-sealed', null);
    return raw ?? undefined;
  }

  saveGithubToken(sealed: Sealed): void {
    this.setSetting('github-pat-sealed', sealed);
  }

  clearGithubToken(): void {
    this.setSetting('github-pat-sealed', null);
  }

  openAIKeySealed(): Sealed | undefined {
    const raw = this.setting<Sealed | null>('openai-key-sealed', null);
    return raw ?? undefined;
  }

  saveOpenAIKey(sealed: Sealed): void {
    this.setSetting('openai-key-sealed', sealed);
  }

  clearOpenAIKey(): void {
    this.setSetting('openai-key-sealed', null);
  }

  huggingFaceKeySealed(): Sealed | undefined {
    const raw = this.setting<Sealed | null>('huggingface-key-sealed', null);
    return raw ?? undefined;
  }

  saveHuggingFaceKey(sealed: Sealed): void {
    this.setSetting('huggingface-key-sealed', sealed);
  }

  clearHuggingFaceKey(): void {
    this.setSetting('huggingface-key-sealed', null);
  }

  githubSyncs(): GitHubSync[] {
    return this.setting<GitHubSync[]>('github-syncs', []);
  }

  saveGithubSyncs(syncs: GitHubSync[]): void {
    this.setSetting('github-syncs', syncs);
  }

  brainEntries(): BrainEntry[] {
    return this.db
      .prepare('SELECT data FROM brain_entries ORDER BY created_at DESC')
      .all()
      .map((row) => JSON.parse(row.data as string) as BrainEntry);
  }

  brainEntry(id: string): BrainEntry | undefined {
    const row = this.db.prepare('SELECT data FROM brain_entries WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data as string) as BrainEntry) : undefined;
  }

  saveBrainEntry(entry: BrainEntry): void {
    this.db
      .prepare(
        `INSERT INTO brain_entries(id, data, created_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(entry.id, JSON.stringify(entry), entry.createdAt);
  }

  deleteBrainEntry(id: string): void {
    this.db.prepare('DELETE FROM brain_entries WHERE id = ?').run(id);
  }

  skills(): Skill[] {
    return this.db
      .prepare('SELECT data FROM skills ORDER BY created_at DESC')
      .all()
      .map((row) => JSON.parse(row.data as string) as Skill);
  }

  skill(id: string): Skill | undefined {
    const row = this.db.prepare('SELECT data FROM skills WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data as string) as Skill) : undefined;
  }

  saveSkill(skill: Skill): void {
    this.db
      .prepare(
        `INSERT INTO skills(id, data, created_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(skill.id, JSON.stringify(skill), skill.createdAt);
  }

  deleteSkill(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  roles(): Role[] {
    return this.db
      .prepare('SELECT data FROM roles ORDER BY created_at DESC')
      .all()
      .map((row) => JSON.parse(row.data as string) as Role);
  }

  role(id: string): Role | undefined {
    const row = this.db.prepare('SELECT data FROM roles WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data as string) as Role) : undefined;
  }

  saveRole(role: Role): void {
    this.db
      .prepare(
        `INSERT INTO roles(id, data, created_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(role.id, JSON.stringify(role), role.createdAt);
  }

  deleteRole(id: string): void {
    this.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
