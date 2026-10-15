import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { basename, extname, join, posix, resolve, sep } from 'node:path';
import type { Client } from 'ssh2';
import { z } from 'zod';
import { Store } from './store.ts';
import { Vault, ApiError, type Sealed } from './vault.ts';
import { listRemote, openSftp, readRemote, type RemoteFile } from './ssh.ts';
import {
  codingTools,
  type Artifact,
  type Agent,
  type CatalogModel,
  type ModelDefaults,
  type Schedule,
  type Task,
} from '../shared/types.ts';

const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 2000;
const formats: Record<string, [Artifact['kind'], string]> = {
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.webp': ['image', 'image/webp'],
  '.gif': ['image', 'image/gif'],
  '.mp4': ['video', 'video/mp4'],
  '.webm': ['video', 'video/webm'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.wav': ['audio', 'audio/wav'],
  '.ogg': ['audio', 'audio/ogg'],
  '.pdf': ['document', 'application/pdf'],
  '.txt': ['document', 'text/plain'],
  '.md': ['document', 'text/plain'],
  '.csv': ['document', 'text/csv'],
  '.docx': ['document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};
const runner = z.enum(['hermes', 'claude', 'codex', 'opencode']);
const scheduleChainStep = z.object({
  agentId: z.string().uuid(),
  instruction: z.string().max(4096).optional(),
  trigger: z.enum(['always', 'on-output']).default('always'),
});
const scheduleInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(64000).default(''),
    agentId: z.string().uuid(),
    runner: runner.default('hermes'),
    nextRun: z.string().datetime(),
    intervalMinutes: z.number().int().min(0).max(525600),
    enabled: z.boolean(),
    chain: z.array(scheduleChainStep).max(10).optional(),
  })
  .strict();
const modelName = z
  .string()
  .trim()
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
export const defaultsInput = z
  .object({
    model: modelName.default(''),
    provider: modelName.default(''),
    tools: z
      .object({ claude: modelName, codex: modelName, opencode: modelName })
      .partial()
      .strict()
      .default({}),
  })
  .strict();
export const emptyDefaults: ModelDefaults = { model: '', provider: '', tools: {} };

export function nextOccurrence(nextRun: string, intervalMinutes: number, now: number): string {
  const step = intervalMinutes * 60000;
  return new Date(
    Date.parse(nextRun) + (Math.floor(Math.max(0, now - Date.parse(nextRun)) / step) + 1) * step,
  ).toISOString();
}

export function normalizeModels(data: unknown): CatalogModel[] {
  if (!Array.isArray(data)) throw new ApiError(502, 'Nous returned an invalid model catalog.');
  const price = (value: unknown): number | null => {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !value.trim())
    )
      return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n * 1000000 : null;
  };
  return data
    .filter((m) => m && typeof m.id === 'string')
    .map((m) => {
      const input = price(m.pricing?.prompt),
        output = price(m.pricing?.completion);
      const subscription = m.pricing?.billing_mode === 'subscription';
      return {
        id: m.id,
        name: typeof m.name === 'string' ? m.name : m.id,
        input,
        output,
        free: !subscription && input === 0 && output === 0,
      };
    });
}

async function fetchCatalog(key: string): Promise<CatalogModel[]> {
  let response: Response;
  try {
    response = await fetch('https://inference-api.nousresearch.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new ApiError(502, 'Could not reach the Nous model catalog. Try again.');
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 400 : 502,
      `Nous catalog request failed (HTTP ${response.status}). Check your API key.`,
    );
  const body = (await response.json()) as { data?: unknown };
  return normalizeModels(body.data);
}

/** Directory listing captured before a remote run, so collection never depends on clocks agreeing. */
export type RemoteBaseline = Map<string, string>;
const signature = (file: RemoteFile) => `${file.size}:${file.mtime}`;

export function workspace(
  app: Express,
  store: Store,
  vault: Vault,
  dataDir: string,
  launch: (task: Task) => Task,
  changed: () => void,
) {
  const schedules = () => store.setting<Schedule[]>('schedules', []);
  const artifacts = () => store.setting<Artifact[]>('artifacts', []);
  const folder = resolve(dataDir, 'artifacts');
  mkdirSync(folder, { recursive: true });
  const addArtifact = (name: string, taskId: string | null, bytes: Buffer) => {
    const format = formats[extname(name).toLowerCase()];
    if (!format)
      throw new ApiError(400, 'Unsupported file type. Use a document, image, audio, or video file.');
    if (bytes.length > MAX_FILE) throw new ApiError(413, 'Files must be at most 25 MB.');
    const all = artifacts();
    if (all.length >= MAX_FILES)
      throw new ApiError(409, 'Library limit reached (2,000 files).', 'LIBRARY_FULL');
    const item: Artifact = {
      id: randomUUID(),
      name: basename(name).slice(0, 200),
      taskId,
      kind: format[0],
      mime: format[1],
      size: bytes.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(folder, item.id), bytes, { flag: 'wx' });
    store.setSetting('artifacts', [...all, item]);
    return item;
  };
  /** Adds collected files until the library fills, and describes what happened. */
  const collectAll = async (
    task: Task,
    files: { name: string; read: () => Buffer | Promise<Buffer> }[],
  ): Promise<string | undefined> => {
    let added = 0;
    for (const [index, file] of files.entries()) {
      try {
        addArtifact(file.name, task.id, await file.read());
        added++;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'LIBRARY_FULL')
          return `Collected ${added} file(s). The library is full (2,000 files), so ${files.length - index} new file(s) stayed in the agent's artifacts folder. Delete old files to make room.`;
        throw error;
      }
    }
    if (added) changed();
    return added ? `Collected ${added} output file(s) into the library.` : undefined;
  };

  app.get('/api/artifacts', (_req, res) => res.json(artifacts()));
  app.post('/api/artifacts', (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(200),
        taskId: z.string().uuid().nullable(),
        content: z.string().max(35 * 1024 * 1024),
      })
      .strict()
      .parse(req.body);
    if (input.taskId && !store.task(input.taskId)) throw new ApiError(404, 'Task not found.');
    res.status(201).json(addArtifact(input.name, input.taskId, Buffer.from(input.content, 'base64')));
  });
  app.get('/api/artifacts/:id/file', (req, res) => {
    const item = artifacts().find((a) => a.id === req.params.id);
    if (!item) throw new ApiError(404, 'File not found.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const extension = extname(item.name).toLowerCase();
    if (req.query.inline && ['.pdf', '.txt', '.md', '.csv'].includes(extension)) {
      // Text is read by the app and shown as plain text. PDFs need Chrome's viewer, which a sandbox CSP blocks.
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader(
        'Content-Security-Policy',
        extension === '.pdf'
          ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
          : "default-src 'none'; sandbox; frame-ancestors 'self'",
      );
      res.setHeader('Content-Disposition', 'inline');
      res.type(extension === '.pdf' ? 'application/pdf' : 'text/plain; charset=utf-8');
      res.sendFile(join(folder, item.id));
      return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (item.kind === 'document' || req.query.download) res.download(join(folder, item.id), item.name);
    else res.type(item.mime).sendFile(join(folder, item.id));
  });
  app.delete('/api/artifacts/:id', (req, res) => {
    const all = artifacts();
    const item = all.find((a) => a.id === req.params.id);
    if (!item) throw new ApiError(404, 'File not found.');
    rmSync(join(folder, item.id), { force: true });
    store.setSetting(
      'artifacts',
      all.filter((a) => a.id !== item.id),
    );
    store.addActivity('system', `File "${item.name}" deleted from the library.`);
    changed();
    res.json({ ok: true });
  });

  app.get('/api/schedules', (_req, res) => res.json(schedules()));
  app.post('/api/schedules', (req, res) => {
    vault.requireUnlocked();
    const input = scheduleInput.parse(req.body);
    if (!store.agent(input.agentId)) throw new ApiError(404, 'Agent not found.');
    if (Date.parse(input.nextRun) <= Date.now()) throw new ApiError(400, 'Choose a future start time.');
    if (schedules().length >= 100) throw new ApiError(409, 'Schedule limit reached.');
    const item = { ...input, id: randomUUID() };
    store.setSetting('schedules', [...schedules(), item]);
    store.addActivity('task', `Schedule "${item.title}" created.`);
    changed();
    res.status(201).json(item);
  });
  app.patch('/api/schedules/:id', (req, res) => {
    vault.requireUnlocked();
    const input = scheduleInput.partial().parse(req.body);
    const all = schedules(),
      index = all.findIndex((s) => s.id === req.params.id);
    if (index < 0) throw new ApiError(404, 'Schedule not found.');
    if (input.agentId && !store.agent(input.agentId)) throw new ApiError(404, 'Agent not found.');
    if (input.nextRun && Date.parse(input.nextRun) <= Date.now())
      throw new ApiError(400, 'Choose a future start time.');
    if (input.enabled && !store.agent(input.agentId ?? all[index].agentId))
      throw new ApiError(409, 'Choose an existing agent before enabling this schedule.');
    all[index] = { ...all[index], ...input, lastError: undefined };
    store.setSetting('schedules', all);
    const verb = input.enabled === undefined ? 'updated' : input.enabled ? 'enabled' : 'paused';
    store.addActivity('task', `Schedule "${all[index].title}" ${verb}.`);
    changed();
    res.json(all[index]);
  });
  app.delete('/api/schedules/:id', (req, res) => {
    vault.requireUnlocked();
    const all = schedules();
    const item = all.find((s) => s.id === req.params.id);
    if (!item) throw new ApiError(404, 'Schedule not found.');
    store.setSetting(
      'schedules',
      all.filter((s) => s.id !== item.id),
    );
    store.addActivity('task', `Schedule "${item.title}" deleted.`);
    changed();
    res.json({ ok: true });
  });

  app.get('/api/defaults', (_req, res) => res.json(store.setting('model-defaults', emptyDefaults)));
  app.put('/api/defaults', (req, res) => {
    const input = defaultsInput.parse(req.body);
    const tools = Object.fromEntries(
      codingTools.flatMap((tool) => (input.tools[tool] ? [[tool, input.tools[tool]]] : [])),
    );
    const value: ModelDefaults = { model: input.model, provider: input.provider, tools };
    store.setSetting('model-defaults', value);
    store.addActivity(
      'agent',
      value.model || value.provider
        ? `Global model set to ${[value.provider, value.model].filter(Boolean).join(' / ')}.`
        : 'Global model cleared. Agents without an override use their Hermes default.',
    );
    changed();
    res.json(value);
  });

  app.get('/api/nous', (_req, res) => {
    const cache = store.setting<{ fetchedAt: string } | null>('nous-catalog', null);
    res.json({ configured: !!store.setting('nous-key', null), fetchedAt: cache?.fetchedAt ?? null });
  });
  app.put('/api/nous', async (req, res) => {
    vault.requireUnlocked();
    const { apiKey } = z
      .object({ apiKey: z.string().trim().min(1).max(4096) })
      .strict()
      .parse(req.body);
    // Verify before saving so a typo surfaces now, not on the next refresh.
    const models = await fetchCatalog(apiKey);
    store.setSetting('nous-key', vault.encrypt('nous-catalog', { password: apiKey }));
    const fetchedAt = new Date().toISOString();
    store.setSetting('nous-catalog', { models, fetchedAt });
    res.json({ configured: true, fetchedAt, count: models.length });
  });
  app.delete('/api/nous', (_req, res) => {
    vault.requireUnlocked();
    store.setSetting('nous-key', null);
    store.setSetting('nous-catalog', null);
    res.json({ configured: false });
  });
  app.get('/api/nous/models', async (req, res) => {
    const cache = store.setting<{ models: CatalogModel[]; fetchedAt: string } | null>('nous-catalog', null);
    if (cache && !req.query.refresh && Date.now() - Date.parse(cache.fetchedAt) < 60 * 60_000) {
      res.json(cache);
      return;
    }
    vault.requireUnlocked();
    const sealed = store.setting<Sealed | null>('nous-key', null);
    if (!sealed) throw new ApiError(409, 'Save your Nous API key to load the live catalog.');
    const models = await fetchCatalog(vault.decrypt('nous-catalog', sealed).password!);
    const value = { models, fetchedAt: new Date().toISOString() };
    store.setSetting('nous-catalog', value);
    res.json(value);
  });

  const tick = () => {
    if (!vault.state.unlocked) return;
    const all = schedules();
    let dirty = false;
    for (const item of all) {
      if (!item.enabled || Date.parse(item.nextRun) > Date.now()) continue;
      if (store.tasks().some((t) => t.scheduleId === item.id && t.status === 'running')) continue;
      const now = new Date().toISOString();
      const chainAgentIds = item.chain?.map((s) => s.agentId) ?? [];
      const chainTrigger = item.chain?.some((s) => s.trigger === 'on-output') ? 'on-output' as const : 'always' as const;
      const task: Task = {
        id: randomUUID(),
        title: item.title,
        description: item.description,
        agentId: item.agentId,
        runner: item.runner ?? 'hermes',
        scheduleId: item.id,
        status: 'ready',
        priority: 'medium',
        createdAt: now,
        updatedAt: now,
        ...(chainAgentIds.length ? { chain: chainAgentIds, chainStep: 1, chainTrigger } : {}),
      };
      // Persist the claim before execution. A crash never retries an uncertain occurrence.
      const previous = { ...item };
      item.enabled = item.intervalMinutes > 0;
      if (item.intervalMinutes) item.nextRun = nextOccurrence(item.nextRun, item.intervalMinutes, Date.now());
      item.lastTaskId = task.id;
      item.lastError = undefined;
      store.setSetting('schedules', all);
      try {
        launch(task);
        dirty = true;
      } catch (error) {
        Object.assign(item, previous);
        item.lastTaskId = previous.lastTaskId;
        item.lastError = error instanceof ApiError ? error.message : 'Schedule could not start.';
        dirty = true;
      }
    }
    if (dirty) {
      store.setSetting('schedules', all);
      changed();
    }
  };
  const timer = setInterval(tick, 10000);
  timer.unref();
  const artifactDir = (agent: Agent, task: Task) => {
    const base = task.workdir || agent.workdir;
    if (agent.transport === 'local') return join(base, 'artifacts');
    return base ? posix.join(base, 'artifacts') : 'artifacts';
  };
  return {
    close: () => clearInterval(timer),
    tick,
    /** Pauses an agent's schedules so the scheduler does not retry a missing agent forever. */
    agentRemoved(agentId: string, name: string) {
      const all = schedules();
      let touched = false;
      for (const item of all)
        if (item.agentId === agentId && item.enabled) {
          item.enabled = false;
          item.lastError = `Agent "${name}" was removed. Choose another agent, then enable the schedule.`;
          touched = true;
        }
      if (touched) store.setSetting('schedules', all);
    },
    taskRemoved(taskId: string) {
      const all = artifacts();
      if (all.some((a) => a.taskId === taskId))
        store.setSetting(
          'artifacts',
          all.map((a) => (a.taskId === taskId ? { ...a, taskId: null } : a)),
        );
    },
    /** Lists the remote artifacts folder before a run. */
    async remoteBaseline(client: Client, agent: Agent, task: Task): Promise<RemoteBaseline> {
      const sftp = await openSftp(client);
      try {
        const files = await listRemote(sftp, artifactDir(agent, task));
        return new Map(files.map((file) => [file.name, signature(file)]));
      } finally {
        sftp.end();
      }
    },
    /** Collects files that are new or changed since the baseline. */
    async collectRemote(client: Client, agent: Agent, task: Task, baseline: RemoteBaseline) {
      const sftp = await openSftp(client);
      try {
        const dir = artifactDir(agent, task);
        const files = (await listRemote(sftp, dir)).filter(
          (file) =>
            formats[extname(file.name).toLowerCase()] &&
            file.size <= MAX_FILE &&
            baseline.get(file.name) !== signature(file),
        );
        return await collectAll(
          task,
          files
            .slice(0, 200)
            .map((file) => ({ name: file.name, read: () => readRemote(sftp, posix.join(dir, file.name)) })),
        );
      } finally {
        sftp.end();
      }
    },
    async collect(agent: Agent, task: Task) {
      if (agent.transport !== 'local' || !(task.workdir || agent.workdir)) return undefined;
      const source = artifactDir(agent, task);
      if (!existsSync(source) || lstatSync(source).isSymbolicLink()) return undefined;
      const real = realpathSync(source);
      const files: { name: string; read: () => Buffer }[] = [];
      for (const entry of readdirSync(source, { withFileTypes: true }).slice(0, 200)) {
        if (!entry.isFile() || !formats[extname(entry.name).toLowerCase()]) continue;
        const file = join(real, entry.name),
          stat = lstatSync(file);
        if (
          stat.isSymbolicLink() ||
          stat.mtimeMs < Date.parse(task.startedAt ?? task.createdAt) ||
          stat.size > MAX_FILE
        )
          continue;
        if (!realpathSync(file).startsWith(real + sep)) continue;
        files.push({ name: entry.name, read: () => readFileSync(file) });
      }
      return collectAll(task, files);
    },
  };
}
