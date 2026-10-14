import express, { type ErrorRequestHandler } from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { Client, ClientChannel } from 'ssh2';
import {
  agentColors,
  codingTools,
  effectiveModel,
  effectiveToolModel,
  runnerNames,
  type Agent,
  type AppSnapshot,
  type ModelDefaults,
  type Runner,
  type ServerEvent,
  type Task,
  type TaskLog,
  type Turn,
} from '../shared/types.ts';
import { Store } from './store.ts';
import { emptyDefaults, workspace, type RemoteBaseline } from './workspace.ts';
import { ApiError, Vault, secretRedactor, type Credentials } from './vault.ts';
import { captureLocal, discoverLocalHermes, discoverLocalTool } from './local.ts';
import { hermesArgs, connectSSH, execCapture, hermesCommand, quote, runAgent } from './ssh.ts';
import { needsInput, parseToolDetection, runners, toolDetectionScript } from './runners.ts';

const clean = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed.');
const credentialSchema = z
  .object({
    password: z.string().min(1).max(4096).optional(),
    privateKey: z
      .string()
      .min(1)
      .max(64 * 1024)
      .optional(),
    passphrase: z.string().max(4096).optional(),
  })
  .strict();
const agentFields = z
  .object({
    transport: z.enum(['ssh', 'local']).optional(),
    name: clean(100).trim().min(1),
    host: clean(253)
      .min(1)
      .refine(
        (host) => isIP(host) !== 0 || /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host),
        'Use a hostname or IP address, not a URL.',
      ),
    port: z.number().int().min(1).max(65535),
    username: clean(128).min(1),
    authType: z.enum(['password', 'privateKey']),
    hermesPath: clean(1024).transform((value) => value || 'hermes'),
    workdir: clean(4096),
    profile: clean(256),
    model: clean(256).trim().optional(),
    provider: clean(128).trim().optional(),
    color: z.enum(agentColors).optional(),
    toolPaths: z
      .object({ claude: clean(1024).trim(), codex: clean(1024).trim(), opencode: clean(1024).trim() })
      .partial()
      .strict()
      .optional(),
    toolModels: z
      .object({ claude: clean(256).trim(), codex: clean(256).trim(), opencode: clean(256).trim() })
      .partial()
      .strict()
      .optional(),
    credentials: credentialSchema.optional(),
  })
  .strict();
/** Fields that only affect future runs; changing them does not require a new connection check. */
const softAgentFields = new Set(['name', 'model', 'provider', 'color', 'toolModels']);
const runnerSchema = z.enum(['hermes', 'claude', 'codex', 'opencode']);
const agentCreate = agentFields.extend({
  port: agentFields.shape.port.default(22),
  hermesPath: agentFields.shape.hermesPath.default('hermes'),
  workdir: agentFields.shape.workdir.default(''),
  profile: agentFields.shape.profile.default(''),
});
const taskFields = z
  .object({
    title: clean(200).trim().min(1),
    description: z
      .string()
      .max(64 * 1024)
      .refine((value) => !value.includes('\0'), 'NUL bytes are not allowed.'),
    agentId: z.string().uuid().nullable(),
    runner: runnerSchema,
    workdir: clean(4096).trim(),
    status: z.enum(['backlog', 'ready', 'waiting', 'review', 'done', 'blocked']),
    priority: z.enum(['low', 'medium', 'high']),
  })
  .strict();
const taskCreate = taskFields.extend({
  description: taskFields.shape.description.default(''),
  agentId: taskFields.shape.agentId.default(null),
  runner: taskFields.shape.runner.default('hermes'),
  workdir: taskFields.shape.workdir.default(''),
  status: taskFields.shape.status.default('backlog'),
  priority: taskFields.shape.priority.default('medium'),
});
const MAX_TURNS = 20;
const addTurn = (turns: Turn[] | undefined, role: Turn['role'], text: string): Turn[] =>
  [...(turns ?? []), { role, text: text.slice(0, 64 * 1024), at: new Date().toISOString() }].slice(
    -MAX_TURNS,
  );

interface FollowUp {
  message: string;
  resume?: string;
}

export interface ManagerOptions {
  dataDir?: string;
  port?: number;
  staticDir?: string;
  probeIntervalMs?: number;
  taskTimeoutMs?: number;
}

interface Operation {
  kind: 'probe' | 'run' | 'terminal';
  controller: AbortController;
}

export function configuredPort(): number {
  const value = process.env.PORT === undefined ? 4310 : Number(process.env.PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('PORT must be an integer from 1 through 65535.');
  return value;
}

export function createManager(options: ManagerOptions = {}) {
  const port = options.port ?? configuredPort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid manager port.');
  const store = new Store(resolve(options.dataDir ?? process.env.HERMES_MANAGER_DATA_DIR ?? 'data'));
  const vault = new Vault(store);
  const csrfToken = randomBytes(32).toString('hex');
  const app = express();
  const server = createServer(app);
  const events = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const terminals = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  const alive = new WeakSet<WebSocket>();
  const operations = new Map<string, Operation>();
  const jobs = new Set<Promise<unknown>>();
  const pendingHostKeys = new Map<string, { host: string; port: number; fingerprint: string; at: number }>();
  let closing = false;
  const authorities = new Set(
    [port, 5173].flatMap((value) => [`127.0.0.1:${value}`, `localhost:${value}`, `[::1]:${value}`]),
  );
  const origins = new Set([...authorities].map((authority) => `http://${authority}`));

  const defaults = () => store.setting<ModelDefaults>('model-defaults', emptyDefaults);
  const nextColor = (taken: Agent[]) => {
    const used = taken.map((agent) => agent.color);
    return (
      agentColors.find((color) => !used.includes(color)) ?? agentColors[taken.length % agentColors.length]
    );
  };
  // Agents created before colours existed get stable, distinct ones.
  for (const agent of store.agents())
    if (!agent.color) store.saveAgent({ ...agent, color: nextColor(store.agents()) });
  const snapshot = (): AppSnapshot => ({
    agents: store
      .agents()
      .map((agent) => (pendingHostKeys.has(agent.id) ? { ...agent, hostKeyPending: true } : agent)),
    tasks: store.tasks(),
    schedules: store.setting('schedules', []),
    defaults: defaults(),
    vault: vault.state,
    activity: store.activity(),
    csrfToken,
  });
  const send = (ws: WebSocket, value: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(value));
  };
  const broadcast = (event: ServerEvent) => {
    for (const ws of events.clients) send(ws, event);
  };
  const changed = () => {
    if (!closing) broadcast({ type: 'state', data: snapshot() });
  };
  const log = (taskId: string, stream: TaskLog['stream'], text: string) => {
    if (!text) return;
    broadcast({ type: 'log', data: store.addLog(taskId, stream, text) });
  };
  const getAgent = (id: string): Agent => {
    const agent = store.agent(id);
    if (!agent) throw new ApiError(404, 'Agent not found.');
    return agent;
  };
  const getTask = (id: string): Task => {
    const task = store.task(id);
    if (!task) throw new ApiError(404, 'Task not found.');
    return task;
  };
  const idle = (agentId: string) => {
    if (
      operations.has(agentId) ||
      store.tasks().some((task) => task.agentId === agentId && task.status === 'running')
    ) {
      throw new ApiError(409, 'Agent has an active task, terminal, or check.', 'AGENT_BUSY');
    }
  };
  const reserve = (agent: Agent, kind: Operation['kind']): Operation => {
    vault.requireUnlocked();
    idle(agent.id);
    if (operations.size >= 8) throw new ApiError(429, 'Too many active SSH operations.');
    const operation = { kind, controller: new AbortController() };
    operations.set(agent.id, operation);
    return operation;
  };
  const track = <T>(job: Promise<T>): Promise<T> => {
    jobs.add(job);
    void job.then(
      () => jobs.delete(job),
      () => jobs.delete(job),
    );
    return job;
  };
  const observe = (agent: Agent) => (value: string) => {
    pendingHostKeys.set(agent.id, { host: agent.host, port: agent.port, fingerprint: value, at: Date.now() });
    store.setCapability(agent.id, false);
  };
  const credentialsFor = (agent: Agent): Credentials =>
    agent.transport === 'local' ? {} : vault.decrypt(agent.id, store.credential(agent.id));
  const trusted = (agent: Agent) => {
    if (agent.transport === 'local') return;
    if (!agent.fingerprint || pendingHostKeys.has(agent.id))
      throw new ApiError(409, 'Probe and verify the SSH host key before connecting.', 'HOST_KEY_REQUIRED');
  };
  const validateCredentials = (authType: Agent['authType'], value: Credentials | undefined): Credentials => {
    if (authType === 'password') {
      if (!value?.password) throw new ApiError(400, 'A password is required for password authentication.');
      if (value.privateKey || value.passphrase)
        throw new ApiError(400, 'Private-key fields are not valid for password authentication.');
      return { password: value.password };
    }
    if (!value?.privateKey)
      throw new ApiError(400, 'A private key is required for private-key authentication.');
    if (value.password) throw new ApiError(400, 'Password is not valid for private-key authentication.');
    return { privateKey: value.privateKey, ...(value.passphrase ? { passphrase: value.passphrase } : {}) };
  };

  async function detectTools(
    agent: Agent,
    client: Client | undefined,
    signal: AbortSignal,
  ): Promise<Agent['tools']> {
    if (agent.transport !== 'local')
      return parseToolDetection(
        await execCapture(client!, `sh -c ${quote(toolDetectionScript(quote, agent.toolPaths))}`, signal),
      );
    const tools: NonNullable<Agent['tools']> = {};
    for (const tool of codingTools) {
      const path = agent.toolPaths?.[tool] || discoverLocalTool(tool);
      if (!path || !isAbsolute(path)) continue;
      try {
        const version = (await captureLocal({ ...agent, hermesPath: path }, ['--version'], signal))
          .trim()
          .split('\n')[0];
        if (version) tools[tool] = { path, version: version.slice(0, 200) };
      } catch {
        /* Not runnable from the manager. */
      }
    }
    return tools;
  }

  async function probe(agent: Agent, operation: Operation): Promise<Agent> {
    let client: Client | undefined;
    let reachable = false;
    let version: string | undefined;
    try {
      const credentials = credentialsFor(agent);
      const redact = secretRedactor(credentials);
      if (agent.transport !== 'local')
        client = await connectSSH(agent, credentials, observe(agent), operation.controller.signal);
      const capture = (mode: 'version' | 'help') =>
        agent.transport === 'local'
          ? captureLocal(agent, hermesArgs(agent, mode), operation.controller.signal)
          : execCapture(client!, hermesCommand(agent, mode), operation.controller.signal);
      version = redact((await capture('version')).trim()).slice(0, 512);
      if (!version) throw new ApiError(502, 'Hermes returned no version.', 'HERMES_UNAVAILABLE');
      reachable = true;
      let help = '';
      try {
        help = await capture('help');
      } catch {
        throw new ApiError(
          409,
          'Hermes is reachable, but its one-shot streaming capabilities could not be verified.',
          'HERMES_UNSUPPORTED',
        );
      }
      if (
        !['--query-file', '--format', '--oneshot'].every((flag) => help.includes(flag)) ||
        !help.includes('stream-json')
      ) {
        throw new ApiError(
          409,
          'Hermes is reachable but lacks --query-file, --format stream-json, or --oneshot. Update Hermes before running tasks.',
          'HERMES_UNSUPPORTED',
        );
      }
      let tools: Agent['tools'] = {};
      try {
        tools = await detectTools(agent, client, operation.controller.signal);
      } catch {
        /* Coding CLIs are optional; Hermes itself is verified. */
      }
      const updated: Agent = {
        ...agent,
        status: 'online',
        version,
        resume: help.includes('--resume'),
        tools,
        lastSeen: new Date().toISOString(),
        lastError: undefined,
      };
      store.saveAgent(updated);
      store.setCapability(agent.id, true);
      return updated;
    } catch (error) {
      const safe =
        error instanceof ApiError ? error : new ApiError(502, 'SSH/Hermes check failed.', 'PROBE_FAILED');
      store.saveAgent({
        ...agent,
        status: reachable ? 'online' : 'offline',
        version: version ?? agent.version,
        lastSeen: reachable ? new Date().toISOString() : agent.lastSeen,
        lastError: safe.message,
      });
      store.setCapability(agent.id, false);
      throw safe;
    } finally {
      operation.controller.abort();
      operations.delete(agent.id);
      changed();
    }
  }

  /** Builds the prompt and command for a run, or explains why the agent cannot run it. */
  function prepare(agent: Agent, task: Task, followUp?: FollowUp) {
    const runner: Runner = task.runner ?? 'hermes';
    const spec = runners[runner];
    const resume = followUp?.resume && spec.canResume(agent) ? followUp.resume : undefined;
    const original = task.description || task.title;
    const prompt = !followUp
      ? original
      : resume
        ? followUp.message
        : `${original}\n\n---\nYour previous response:\n${task.report ?? '(no response was recorded)'}\n\n---\nFollow-up from the user:\n${followUp.message}`;
    const resolved =
      runner === 'hermes'
        ? effectiveModel(agent, defaults())
        : { model: effectiveToolModel(agent, defaults(), runner), provider: '' };
    try {
      const invocation = spec.build(agent, {
        prompt,
        resume,
        workdir: task.workdir || agent.workdir,
        model: resolved.model,
        provider: resolved.provider,
      });
      return { runner, spec, prompt, invocation, resumed: !!resume };
    } catch (error) {
      throw new ApiError(409, (error as Error).message, 'RUNNER_UNAVAILABLE');
    }
  }

  async function executeTask(
    agent: Agent,
    task: Task,
    operation: Operation,
    plan: ReturnType<typeof prepare>,
  ): Promise<void> {
    let client: Client | undefined;
    let baseline: RemoteBaseline | undefined;
    const name = runnerNames[plan.runner];
    const timer = setTimeout(() => operation.controller.abort(), options.taskTimeoutMs ?? 60 * 60 * 1000);
    let redact: (text: string) => string = () => '[unavailable]';
    try {
      const credentials = credentialsFor(agent);
      redact = secretRedactor(credentials);
      const filters = {
        stdout: secretRedactor(credentials, true),
        stderr: secretRedactor(credentials, true),
      };
      let bytes = 0;
      let count = 0;
      let capped = false;
      const taskLog = (stream: TaskLog['stream'], text: string) => {
        if (!text || capped) return;
        bytes += Buffer.byteLength(text);
        if (bytes > 8 * 1024 * 1024 || ++count > 10_000) {
          capped = true;
          log(
            task.id,
            'system',
            'Live log limit reached. Further output will not be saved; the final result is still collected.',
          );
          return;
        }
        log(task.id, stream, stream === 'system' ? redact(text) : filters[stream](text));
      };
      if (agent.transport !== 'local') {
        client = await connectSSH(agent, credentials, observe(agent), operation.controller.signal);
        try {
          baseline = await workspaceService.remoteBaseline(client, agent, task);
        } catch {
          /* No SFTP: remote outputs are not collected for this run. */
        }
      }
      const outcome = await runAgent(
        client,
        agent,
        plan.invocation,
        plan.spec.parser(),
        operation.controller.signal,
        taskLog,
        (sessionId) => {
          store.saveTask({ ...getTask(task.id), sessionId: redact(sessionId) });
          changed();
        },
      );
      if (!capped) {
        log(task.id, 'stdout', filters.stdout('', true));
        log(task.id, 'stderr', filters.stderr('', true));
      }
      const now = new Date().toISOString();
      const report = outcome.report === undefined ? undefined : redact(outcome.report);
      const waiting = outcome.waiting ?? (outcome.success ? needsInput(report) : undefined);
      const current = getTask(task.id);
      const updated: Task = {
        ...current,
        status: waiting ? 'waiting' : outcome.success ? 'review' : 'blocked',
        updatedAt: now,
        finishedAt: outcome.exitCode !== undefined ? now : undefined,
        report,
        sessionId: outcome.sessionId === undefined ? current.sessionId : redact(outcome.sessionId),
        exitCode: outcome.exitCode,
        error: outcome.error === undefined ? undefined : redact(outcome.error),
        waitingReason: waiting ? redact(waiting) : undefined,
        turns: report ? addTurn(current.turns, 'agent', report) : current.turns,
      };
      store.saveTask(updated);
      store.saveAgent({
        ...getAgent(agent.id),
        status: outcome.success ? 'online' : 'unknown',
        lastSeen: now,
        lastError: updated.error,
      });
      log(
        task.id,
        'system',
        waiting
          ? `${name} is waiting on you: ${updated.waitingReason}`
          : (updated.error ?? `${name} finished successfully. The task is ready for human review.`),
      );
      store.addActivity(
        'task',
        waiting
          ? `Task "${task.title}" needs your input.`
          : `Task "${task.title}" moved to ${updated.status}.`,
      );
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Task connection failed. Remote outcome is unknown; inspect the host before retrying.';
      const safe = redact(message);
      store.saveTask({
        ...getTask(task.id),
        status: 'blocked',
        updatedAt: new Date().toISOString(),
        error: safe,
      });
      store.saveAgent({ ...getAgent(agent.id), status: 'offline', lastError: safe });
      log(task.id, 'system', safe);
      store.addActivity('task', `Task "${task.title}" is blocked.`);
    } finally {
      clearTimeout(timer);
      try {
        const latest = store.task(task.id) ?? task;
        const note =
          client && baseline && !operation.controller.signal.aborted
            ? await workspaceService.collectRemote(client, agent, latest, baseline)
            : await workspaceService.collect(agent, latest);
        if (note) log(task.id, 'system', note);
      } catch {
        log(
          task.id,
          'system',
          "Some output files could not be collected. Check the agent's artifacts folder.",
        );
      }
      operation.controller.abort();
      operations.delete(agent.id);
      changed();
    }
  }

  function requestAllowed(req: IncomingMessage, websocket = false): boolean {
    const hostCount = req.rawHeaders.filter(
      (_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host',
    ).length;
    const originCount = req.rawHeaders.filter(
      (_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'origin',
    ).length;
    return (
      hostCount === 1 &&
      originCount <= 1 &&
      authorities.has(req.headers.host ?? '') &&
      (req.headers.origin === undefined ? !websocket : origins.has(req.headers.origin)) &&
      req.headers['sec-fetch-site'] !== 'cross-site'
    );
  }
  const tokenMatches = (token: unknown) =>
    typeof token === 'string' &&
    /^[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken));

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (!requestAllowed(req)) {
      next(new ApiError(403, 'Only local manager requests are allowed.', 'ORIGIN_REJECTED'));
      return;
    }
    if (closing) {
      next(new ApiError(503, 'Manager is shutting down.'));
      return;
    }
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !tokenMatches(req.headers['x-manager-token'])) {
      next(new ApiError(403, 'Manager token is missing or invalid.', 'TOKEN_REJECTED'));
      return;
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) > 0) &&
      !req.is('application/json')
    ) {
      next(new ApiError(415, 'Request body must be application/json.'));
      return;
    }
    next();
  });
  app.use('/api/artifacts', express.json({ limit: '36mb', strict: true }));
  app.use(express.json({ limit: '256kb', strict: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/state', (_req, res) => res.json(snapshot()));
  app.post('/api/vault/unlock', async (req, res) => {
    const { passphrase } = z.object({ passphrase: z.string() }).strict().parse(req.body);
    await track(vault.unlock(passphrase));
    store.addActivity('system', 'Vault unlocked.');
    changed();
    res.json(snapshot());
  });
  app.post('/api/vault/lock', (_req, res) => {
    if (operations.size)
      throw new ApiError(
        409,
        'Wait for active tasks, terminals, and checks to end before locking.',
        'OPERATIONS_ACTIVE',
      );
    vault.lock();
    store.addActivity('system', 'Vault locked.');
    changed();
    res.json(snapshot());
  });

  app.get('/api/local-hermes', (_req, res) => {
    res.json({ hermesPath: discoverLocalHermes() ?? null });
  });

  app.post('/api/agents', (req, res) => {
    vault.requireUnlocked();
    if (store.agents().length >= 100) throw new ApiError(409, 'Agent limit reached (100).');
    const { credentials, ...input } = agentCreate.parse(req.body);
    const id = randomUUID();
    if (
      input.transport === 'local' &&
      (!isAbsolute(input.hermesPath) || (input.workdir && !isAbsolute(input.workdir)))
    )
      throw new ApiError(400, 'Local executable and working directory must be absolute paths.');
    if (input.transport === 'local' && credentials)
      throw new ApiError(400, 'Local agents do not use SSH credentials.');
    const encrypted = vault.encrypt(
      id,
      input.transport === 'local' ? {} : validateCredentials(input.authType, credentials),
    );
    const agent: Agent = {
      ...input,
      color: input.color ?? nextColor(store.agents()),
      id,
      status: 'unknown',
      hasCredential: input.transport !== 'local',
      createdAt: new Date().toISOString(),
    };
    store.saveAgent(agent, encrypted);
    store.addActivity('agent', `Agent "${agent.name}" added.`);
    changed();
    res.status(201).json(agent);
  });
  // Declared before /:id so "bulk" is never read as an agent id.
  app.post('/api/agents/bulk', (req, res) => {
    vault.requireUnlocked();
    const input = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(100),
        model: clean(256).trim(),
        provider: clean(128).trim(),
      })
      .strict()
      .parse(req.body);
    const agents = input.ids.map(getAgent);
    for (const agent of agents)
      store.saveAgent({ ...getAgent(agent.id), model: input.model, provider: input.provider });
    store.addActivity(
      'agent',
      input.model || input.provider
        ? `Model ${[input.provider, input.model].filter(Boolean).join(' / ')} set on ${agents.length} agent(s).`
        : `${agents.length} agent(s) now follow the global model.`,
    );
    changed();
    res.json(snapshot());
  });
  app.patch('/api/agents/:id', (req, res) => {
    vault.requireUnlocked();
    const agent = getAgent(req.params.id);
    const { credentials, ...input } = agentFields.partial().parse(req.body);
    const soft = credentials === undefined && Object.keys(input).every((key) => softAgentFields.has(key));
    if (soft) {
      // Model, name, and colour changes apply to the next run; the agent stays checked and may stay busy.
      const updated: Agent = { ...agent, ...input };
      store.saveAgent(updated);
      store.addActivity('agent', `Agent "${updated.name}" updated.`);
      changed();
      res.json(updated);
      return;
    }
    idle(agent.id);
    if (input.transport && input.transport !== (agent.transport ?? 'ssh'))
      throw new ApiError(400, 'Add a new agent to change connection type.');
    if (agent.transport === 'local' && credentials)
      throw new ApiError(400, 'Local agents do not use SSH credentials.');
    if (
      agent.transport === 'local' &&
      (!isAbsolute(input.hermesPath ?? agent.hermesPath) ||
        ((input.workdir ?? agent.workdir) && !isAbsolute(input.workdir ?? agent.workdir)))
    )
      throw new ApiError(400, 'Local executable and working directory must be absolute paths.');
    const updated: Agent = {
      ...agent,
      ...input,
      status: 'unknown',
      lastError: undefined,
      version: undefined,
    };
    const encrypted =
      credentials === undefined
        ? undefined
        : vault.encrypt(agent.id, validateCredentials(updated.authType, credentials));
    if (updated.authType !== agent.authType && !encrypted)
      throw new ApiError(400, 'New credentials are required when changing authentication type.');
    if (updated.host !== agent.host || updated.port !== agent.port) {
      updated.fingerprint = undefined;
      updated.lastSeen = undefined;
      pendingHostKeys.delete(agent.id);
    }
    store.saveAgent(updated, encrypted);
    store.setCapability(agent.id, false);
    store.addActivity('agent', `Agent "${updated.name}" updated.`);
    changed();
    res.json(updated);
  });
  app.delete('/api/agents/:id', (req, res) => {
    const agent = getAgent(req.params.id);
    idle(agent.id);
    store.deleteAgent(agent.id);
    pendingHostKeys.delete(agent.id);
    workspaceService.agentRemoved(agent.id, agent.name);
    store.addActivity('agent', `Agent "${agent.name}" removed; task history retained.`);
    changed();
    res.json(snapshot());
  });
  app.post('/api/agents/:id/probe', async (req, res) => {
    const agent = getAgent(req.params.id);
    const operation = reserve(agent, 'probe');
    res.json(await track(probe(agent, operation)));
  });
  app.post('/api/agents/:id/trust', (req, res) => {
    vault.requireUnlocked();
    const agent = getAgent(req.params.id);
    idle(agent.id);
    const { fingerprint } = z
      .object({ fingerprint: z.string().max(100) })
      .strict()
      .parse(req.body);
    const pending = pendingHostKeys.get(agent.id);
    if (
      !pending ||
      pending.fingerprint !== fingerprint ||
      pending.host !== agent.host ||
      pending.port !== agent.port ||
      Date.now() - pending.at > 5 * 60_000
    ) {
      throw new ApiError(
        409,
        'This fingerprint was not recently observed for this host. Probe again before trusting.',
        'HOST_KEY_NOT_OBSERVED',
      );
    }
    const updated: Agent = { ...agent, fingerprint, status: 'unknown', lastError: undefined };
    store.saveAgent(updated);
    store.setCapability(agent.id, false);
    pendingHostKeys.delete(agent.id);
    store.addActivity('agent', `SSH host key explicitly trusted for "${agent.name}".`);
    changed();
    res.json(updated);
  });

  app.post('/api/tasks', (req, res) => {
    if (store.tasks().length >= 5000) throw new ApiError(409, 'Task limit reached (5000).');
    const input = taskCreate.parse(req.body);
    if (input.agentId) getAgent(input.agentId);
    const now = new Date().toISOString();
    const task: Task = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    store.saveTask(task);
    store.addActivity('task', `Task "${task.title}" created.`);
    changed();
    res.status(201).json(task);
  });
  app.patch('/api/tasks/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (task.status === 'running') throw new ApiError(409, 'Running tasks cannot be edited.', 'TASK_RUNNING');
    const input = taskFields.partial().parse(req.body);
    if (input.agentId) getAgent(input.agentId);
    const updated: Task = { ...task, ...input, updatedAt: new Date().toISOString() };
    // Leaving "Needs you" by hand settles the question.
    if (input.status && input.status !== 'waiting') updated.waitingReason = undefined;
    store.saveTask(updated);
    changed();
    res.json(updated);
  });
  app.delete('/api/tasks/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (task.status === 'running')
      throw new ApiError(409, 'Running tasks cannot be deleted.', 'TASK_RUNNING');
    store.deleteTask(task.id);
    workspaceService.taskRemoved(task.id);
    store.addActivity('task', `Task "${task.title}" deleted.`);
    changed();
    res.json(snapshot());
  });
  app.get('/api/tasks/:id/logs', (req, res) => {
    res.json(store.logs(getTask(req.params.id).id));
  });
  function launchTask(task: Task, followUp?: FollowUp): Task {
    if (task.status === 'running') throw new ApiError(409, 'Task is already running.', 'TASK_RUNNING');
    if (!task.agentId) throw new ApiError(409, 'Assign an agent before running this task.');
    const agent = getAgent(task.agentId);
    vault.requireUnlocked();
    trusted(agent);
    if (!store.capability(agent.id))
      throw new ApiError(
        409,
        'Run a successful agent check before launching tasks.',
        'HERMES_CHECK_REQUIRED',
      );
    const plan = prepare(agent, task, followUp);
    const operation = reserve(agent, 'run');
    const now = new Date().toISOString();
    const running: Task = {
      ...task,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      finishedAt: undefined,
      report: undefined,
      sessionId: plan.resumed ? task.sessionId : undefined,
      exitCode: undefined,
      error: undefined,
      waitingReason: undefined,
      turns: followUp ? addTurn(task.turns, 'user', followUp.message) : addTurn([], 'user', plan.prompt),
    };
    store.saveTask(running);
    store.saveAgent({ ...agent, status: 'busy', lastError: undefined });
    store.addActivity(
      'task',
      followUp
        ? `Reply sent to "${agent.name}" for "${task.title}".`
        : `Task "${task.title}" launched on "${agent.name}".`,
    );
    const name = runnerNames[plan.runner];
    log(
      task.id,
      'system',
      followUp
        ? plan.resumed
          ? `Sending your reply to the same ${name} session.`
          : `${name} cannot resume this session, so your reply starts a new run with the previous response as context.`
        : plan.runner === 'hermes'
          ? 'Starting one-shot Hermes task. A lost connection does not prove the remote task stopped.'
          : `Starting ${name} in ${task.workdir || agent.workdir || 'the home directory'}. It may edit files there. A lost connection does not prove the remote task stopped.`,
    );
    changed();
    void track(executeTask(agent, running, operation, plan));
    return running;
  }
  app.post('/api/tasks/:id/run', (req, res) => res.status(202).json(launchTask(getTask(req.params.id))));
  app.post('/api/tasks/:id/reply', (req, res) => {
    const task = getTask(req.params.id);
    const { message } = z
      .object({
        message: z
          .string()
          .trim()
          .min(1)
          .max(32 * 1024)
          .refine((value) => !value.includes('\0'), 'NUL bytes are not allowed.'),
      })
      .strict()
      .parse(req.body);
    if (!task.startedAt) throw new ApiError(409, 'Run the task before replying to it.');
    res.status(202).json(launchTask(task, { message, resume: task.sessionId }));
  });
  const workspaceService = workspace(
    app,
    store,
    vault,
    resolve(options.dataDir ?? process.env.HERMES_MANAGER_DATA_DIR ?? 'data'),
    (task) => launchTask(task),
    changed,
  );

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API route not found.')));
  const staticDir = resolve(options.staticDir ?? 'dist');
  if (existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { dotfiles: 'deny', index: false }));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(resolve(staticDir, 'index.html'));
    });
  }
  app.use((_req, _res, next) => next(new ApiError(404, 'Not found. Build the UI for production use.')));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.fingerprint ? { fingerprint: error.fingerprint } : {}),
      });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request fields.', code: 'VALIDATION_ERROR' });
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large.' });
    } else if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON request.' });
    } else {
      res.status(500).json({ error: 'Internal manager error.', code: 'INTERNAL_ERROR' });
    }
  };
  app.use(errors);

  async function terminal(ws: WebSocket, agentId: string): Promise<void> {
    let operation: Operation | undefined;
    let client: Client | undefined;
    let channel: ClientChannel | undefined;
    let agent: Agent | undefined;
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveEnd: () => void = () => {};
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      send(ws, { type: 'status', status: 'closed' });
      channel?.close();
      operation?.controller.abort();
      if (ws.readyState === WebSocket.OPEN) ws.close(1000);
      resolveEnd();
    };
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        send(ws, { type: 'error', message: 'Terminal closed after 15 minutes without input.' });
        end();
      }, 15 * 60_000);
    };
    ws.once('close', end);
    ws.once('error', end);
    timer = setTimeout(() => {
      send(ws, { type: 'error', message: 'Terminal connection timed out.' });
      end();
    }, 30_000);
    ws.on('message', (data, binary) => {
      if (ended) return;
      try {
        if (binary) throw new Error();
        const message: unknown = JSON.parse(data.toString());
        const parsed = z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('input'), data: z.string().max(8192) }).strict(),
            z
              .object({
                type: z.literal('resize'),
                cols: z.number().int().min(2).max(500),
                rows: z.number().int().min(2).max(300),
              })
              .strict(),
          ])
          .parse(message);
        if (!channel) return;
        touch();
        if (parsed.type === 'input') {
          if (channel.writableLength > 64 * 1024) throw new Error();
          channel.write(parsed.data);
        } else channel.setWindow(parsed.rows, parsed.cols, 0, 0);
      } catch {
        send(ws, { type: 'error', message: 'Invalid or excessive terminal input.' });
        end();
      }
    });
    try {
      agent = getAgent(agentId);
      if (agent.transport === 'local')
        throw new ApiError(
          400,
          'Interactive shells are available for SSH agents only. Use tasks to run local Hermes.',
        );
      trusted(agent);
      operation = reserve(agent, 'terminal');
      operation.controller.signal.addEventListener('abort', end, { once: true });
      const credentials = credentialsFor(agent);
      const stdoutFilter = secretRedactor(credentials, true);
      const stderrFilter = secretRedactor(credentials, true);
      client = await connectSSH(agent, credentials, observe(agent), operation.controller.signal);
      if (ended) return;
      client.once('error', () => {
        send(ws, { type: 'error', message: 'Terminal SSH connection failed.' });
        end();
      });
      client.once('close', end);
      await new Promise<void>((resolveDone, reject) => {
        resolveEnd = resolveDone;
        client!.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (error, stream) => {
          if (ended) {
            stream?.close();
            resolveDone();
            return;
          }
          if (error) {
            reject(new ApiError(502, 'Could not open an interactive SSH shell.'));
            return;
          }
          channel = stream;
          const stdout = new StringDecoder('utf8');
          const stderr = new StringDecoder('utf8');
          stream.on('data', (data: Buffer) =>
            send(ws, { type: 'output', data: stdoutFilter(stdout.write(data)) }),
          );
          stream.stderr.on('data', (data: Buffer) =>
            send(ws, { type: 'output', data: stderrFilter(stderr.write(data)) }),
          );
          stream.once('end', () => send(ws, { type: 'output', data: stdoutFilter(stdout.end(), true) }));
          stream.stderr.once('end', () =>
            send(ws, { type: 'output', data: stderrFilter(stderr.end(), true) }),
          );
          stream.once('error', () => {
            send(ws, { type: 'error', message: 'Terminal SSH channel failed.' });
            end();
          });
          stream.once('close', end);
          send(ws, { type: 'status', status: 'connected' });
          touch();
        });
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Terminal connection failed.';
      if (agent && operation)
        store.saveAgent({ ...getAgent(agent.id), status: 'offline', lastError: message });
      send(ws, { type: 'error', message });
    } finally {
      end();
      if (agent && operation) operations.delete(agent.id);
      changed();
    }
  }

  events.on('connection', (ws) => {
    ws.on('error', () => ws.terminate());
    send(ws, { type: 'state', data: snapshot() });
  });
  for (const websocketServer of [events, terminals]) {
    websocketServer.on('connection', (ws) => {
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
    });
  }
  server.on('upgrade', (req, socket, head) => {
    const reject = (status: number) => {
      // Upgraded sockets bypass closeAllConnections(); do not wait for the peer's FIN.
      const timer = setTimeout(() => socket.destroy(), 1000);
      timer.unref();
      socket.once('close', () => clearTimeout(timer));
      socket.once('finish', () => socket.destroy());
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    socket.on('error', () => socket.destroy());
    if (closing || req.method !== 'GET' || !requestAllowed(req, true)) {
      reject(403);
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      reject(400);
      return;
    }
    if (url.searchParams.getAll('token').length !== 1 || !tokenMatches(url.searchParams.get('token'))) {
      reject(403);
      return;
    }
    if (url.pathname === '/ws/events') {
      if (events.clients.size >= 32) {
        reject(429);
        return;
      }
      events.handleUpgrade(req, socket, head, (ws) => events.emit('connection', ws, req));
    } else if (url.pathname === '/ws/terminal') {
      if (terminals.clients.size >= 8) {
        reject(429);
        return;
      }
      terminals.handleUpgrade(req, socket, head, (ws) => {
        terminals.emit('connection', ws, req);
        void track(terminal(ws, url.searchParams.get('agentId') ?? ''));
      });
    } else reject(404);
  });

  let checking = false;
  const checks = setInterval(() => {
    if (closing || checking || !vault.state.unlocked) return;
    const candidates = store
      .agents()
      .filter(
        (agent) => (agent.transport === 'local' || agent.fingerprint) && !pendingHostKeys.has(agent.id),
      );
    let cursor = 0;
    checking = true;
    const worker = async () => {
      while (!closing && vault.state.unlocked && cursor < candidates.length) {
        const candidate = candidates[cursor++];
        // Refresh after each await: another request may have edited or removed the agent.
        const agent = store.agent(candidate.id);
        if (
          !agent ||
          (agent.transport !== 'local' && !agent.fingerprint) ||
          operations.has(agent.id) ||
          pendingHostKeys.has(agent.id) ||
          operations.size >= 8
        )
          continue;
        try {
          await probe(agent, reserve(agent, 'probe'));
        } catch {
          /* Probe already saved its public status and safe error. */
        }
      }
    };
    void track(
      Promise.all([worker(), worker()]).finally(() => {
        checking = false;
      }),
    );
  }, options.probeIntervalMs ?? 30_000);
  checks.unref();
  const heartbeat = setInterval(() => {
    for (const ws of [...events.clients, ...terminals.clients]) {
      if (!alive.has(ws) || ws.bufferedAmount > 1024 * 1024) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) {
        alive.delete(ws);
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();

  let closePromise: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    workspaceService.close();
    clearInterval(checks);
    clearInterval(heartbeat);
    vault.dispose();
    for (const operation of operations.values()) operation.controller.abort();
    for (const ws of [...events.clients, ...terminals.clients]) ws.terminate();
    closePromise = (async () => {
      await Promise.allSettled([...jobs]);
      events.close();
      terminals.close();
      if (server.listening) {
        const stopped = new Promise<void>((resolveDone) => server.close(() => resolveDone()));
        server.closeAllConnections();
        await stopped;
      }
      store.close();
    })();
    return closePromise;
  }
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { app, server, close, snapshot, port };
}
