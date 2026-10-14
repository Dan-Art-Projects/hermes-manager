import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2, { type Client, type ConnectConfig, type Connection, type ServerChannel } from 'ssh2';
import { WebSocket } from 'ws';
import { createManager, type ManagerOptions } from '../server/app.ts';
import { fingerprint, hermesCommand } from '../server/ssh.ts';
import type { Agent, AppSnapshot, Task } from '../shared/types.ts';

const passphrase = 'integration vault passphrase';
const { Server: SSHServer, utils } = ssh2;
const password = 'test-SSH-credential-9321';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();

async function fixture(t: TestContext, timeout = 5000, options: ManagerOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'hermes-api-'));
  const manager = createManager({
    dataDir: directory,
    probeIntervalMs: 60_000,
    taskTimeoutMs: timeout,
    ...options,
  });
  manager.server.listen(0, '127.0.0.1');
  await once(manager.server, 'listening');
  const address = manager.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  let token = '';
  const sockets = new Set<WebSocket>();
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await manager.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function api(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string | undefined> = {},
  ) {
    return await new Promise<{ status: number; body: any; headers: Record<string, unknown> }>(
      (resolveDone, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const values: Record<string, string> = {
          Host: `127.0.0.1:${manager.port}`,
          Origin: 'http://127.0.0.1:5173',
          'X-Manager-Token': token,
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        };
        for (const [name, value] of Object.entries(headers)) {
          if (value === undefined) delete values[name];
          else values[name] = value;
        }
        const req = request({ hostname: '127.0.0.1', port, path, method, headers: values }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => {
            try {
              resolveDone({
                status: res.statusCode!,
                body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text,
                headers: res.headers,
              });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on('error', reject);
        req.end(data);
      },
    );
  }
  token = (await api('/api/state')).body.csrfToken;
  function ws(path: string, origin: string | null = 'http://127.0.0.1:5173', overrideToken = token) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(overrideToken)}`,
      { headers: { Host: `127.0.0.1:${manager.port}`, ...(origin === null ? {} : { Origin: origin }) } },
    );
    sockets.add(socket);
    socket.on('error', () => {});
    return socket;
  }
  return { manager, api, ws, directory, token };
}

async function sshFixture(t: TestContext, hostKey = key, port = 0) {
  const transports = new Set<Socket>();
  const channels = new Set<ServerChannel>();
  const fixture = {
    auth: [] as string[],
    commands: [] as string[],
    prompts: [] as string[],
    ptys: 0,
    resizes: [] as { rows: number; cols: number }[],
    mode: 'success' as 'success' | 'failure' | 'no-result' | 'hang' | 'disconnect',
    help: '--query-file --format {text,stream-json} --oneshot',
    tools:
      'claude\t/opt/bin/claude\t2.0.0 (Claude Code)\ncodex\t/opt/bin/codex\tcodex-cli 0.50.0\nopencode\t\t\n',
    terminalClosed: false,
    stallCleanup: false,
  };
  const server = new SSHServer({ hostKeys: [hostKey] }, (connection) => {
    // Pause the real transport to simulate a peer that stops reading cleanup packets.
    const transport = (connection as Connection & { _sock: Socket })._sock;
    transports.add(transport);
    transport.once('close', () => transports.delete(transport));
    connection.on('error', () => {});
    connection.on('authentication', (context) => {
      fixture.auth.push(context.method);
      if (context.method === 'password' && context.username === 'tester' && context.password === password)
        context.accept();
      else context.reject(['password']);
    });
    connection.on('ready', () =>
      connection.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => {
          fixture.ptys++;
          accept?.();
        });
        session.on('window-change', (accept, _reject, info) => {
          fixture.resizes.push(info);
          accept?.();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          channels.add(stream);
          stream.on('error', () => {});
          stream.on('close', () => {
            fixture.terminalClosed = true;
            channels.delete(stream);
          });
          stream.write('test shell ready\r\n');
          stream.on('data', (data: Buffer) => stream.write(`echo:${data.toString('utf8')}`));
          stream.on('end', () => stream.end());
          if (fixture.stallCleanup) transport.pause();
        });
        session.on('exec', (accept, _reject, info) => {
          fixture.commands.push(info.command);
          const stream = accept();
          channels.add(stream);
          stream.on('close', () => channels.delete(stream));
          stream.on('error', () => {});
          if (info.command.endsWith("'--version'")) {
            stream.write('Hermes 0.99.test\n');
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command.startsWith('sh -c ') && info.command.includes('command -v')) {
            stream.write(fixture.tools);
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command.endsWith("'--help'")) {
            stream.write(fixture.help);
            stream.exit(0);
            stream.end();
            if (fixture.stallCleanup) transport.pause();
            return;
          }
          let prompt = '';
          stream.on('data', (chunk: Buffer) => {
            prompt += chunk.toString('utf8');
          });
          stream.on('end', () => {
            fixture.prompts.push(prompt);
            const mode = fixture.mode;
            if (info.command.includes("'/opt/bin/claude' '-p'")) {
              const resumed = info.command.includes("'--resume' 'claude-session'");
              stream.write('{"type":"system","subtype":"init","session_id":"claude-session"}\n');
              stream.write(
                JSON.stringify({
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: 'Looking around' }] },
                }) + '\n',
              );
              stream.write(
                JSON.stringify({
                  type: 'result',
                  subtype: 'success',
                  is_error: false,
                  session_id: 'claude-session',
                  result: resumed
                    ? 'Migration finished.'
                    : 'I found two schemas.\n\nShould I migrate both of them?',
                  permission_denials: [],
                }) + '\n',
              );
              stream.exit(0);
              stream.end();
              return;
            }
            stream.write('{"type":"system","subtype":"init","session_id":"session-test"}\n');
            if (mode === 'hang') return;
            if (mode === 'disconnect') {
              connection.end();
              return;
            }
            setTimeout(() => {
              if (stream.destroyed) return;
              stream.write('{"type":"text","text":"Hello ');
              stream.write('there"}\n');
              stream.stderr.write(`diagnostic ${password}\n`);
              if (mode !== 'no-result')
                stream.write(
                  JSON.stringify({
                    type: 'result',
                    text: `Final report ${password}`,
                    session_id: 'session-final',
                    exit_code: mode === 'failure' ? 1 : 0,
                    ...(mode === 'failure' ? { error: 'Hermes test failure' } : {}),
                  }) + '\n',
                );
              stream.exit(mode === 'failure' ? 1 : 0);
              stream.end();
              if (fixture.stallCleanup) transport.pause();
            }, 120);
          });
        });
      }),
    );
  });
  server.on('error', () => {});
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const parsed = utils.parseKey(hostKey);
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed));
  let stopped = false;
  const close = async () => {
    if (stopped) return;
    stopped = true;
    for (const channel of channels) channel.destroy();
    for (const transport of transports) transport.destroy();
    await new Promise<void>((resolveDone) => server.close(() => resolveDone()));
  };
  t.after(close);
  return {
    ...fixture,
    get mode() {
      return fixture.mode;
    },
    set mode(value) {
      fixture.mode = value;
    },
    get help() {
      return fixture.help;
    },
    set help(value) {
      fixture.help = value;
    },
    get stallCleanup() {
      return fixture.stallCleanup;
    },
    set stallCleanup(value) {
      fixture.stallCleanup = value;
    },
    get ptys() {
      return fixture.ptys;
    },
    get terminalClosed() {
      return fixture.terminalClosed;
    },
    port: address.port,
    fingerprint: fingerprint(parsed.getPublicSSH()),
    close,
  };
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for expected state');
}

async function addAgent(api: Awaited<ReturnType<typeof fixture>>['api'], port: number): Promise<Agent> {
  assert.equal((await api('/api/vault/unlock', 'POST', { passphrase })).status, 200);
  const response = await api('/api/agents', 'POST', {
    name: 'Local SSH test',
    host: '127.0.0.1',
    port,
    username: 'tester',
    authType: 'password',
    hermesPath: '/opt/hermes app',
    profile: "profile's name",
    workdir: '/work/a b',
    credentials: { password },
  });
  assert.equal(response.status, 201);
  return response.body as Agent;
}

async function trustAgent(api: Awaited<ReturnType<typeof fixture>>['api'], agent: Agent, expected: string) {
  const rejected = await api(`/api/agents/${agent.id}/probe`, 'POST');
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'HOST_KEY_UNTRUSTED');
  assert.equal(rejected.body.fingerprint, expected);
  assert.equal((await api(`/api/agents/${agent.id}/trust`, 'POST', { fingerprint: expected })).status, 200);
  const probe = await api(`/api/agents/${agent.id}/probe`, 'POST');
  assert.equal(probe.status, 200, JSON.stringify(probe.body));
  assert.equal(probe.body.status, 'online');
}

test('HTTP and websocket guards enforce exact loopback authorities, Origin, and process token', async (t) => {
  const { api, ws, token } = await fixture(t);
  const state = await api('/api/state');
  assert.equal(state.status, 200);
  assert.equal(token.length, 64);
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.equal(state.headers['access-control-allow-origin'], undefined);
  for (const Host of ['attacker.example:4310', '127.0.0.1:43101', 'localhost', 'localhost:4310.evil.test'])
    assert.equal((await api('/api/state', 'GET', undefined, { Host })).status, 403);
  for (const Origin of [
    'null',
    'https://localhost:4310',
    'http://evil.test:5173',
    'http://127.0.0.1:9999',
    'http://localhost:4310/',
  ])
    assert.equal((await api('/api/state', 'GET', undefined, { Origin })).status, 403);
  assert.equal((await api('/api/state', 'GET', undefined, { Origin: undefined })).status, 200);
  assert.equal(
    (await api('/api/tasks', 'POST', { title: 'No token' }, { 'X-Manager-Token': undefined })).status,
    403,
  );
  assert.equal(
    (await api('/api/tasks', 'POST', { title: 'Bad token' }, { 'X-Manager-Token': 'bad' })).status,
    403,
  );
  assert.equal(
    (await api('/api/tasks', 'POST', { title: 'Bad content type' }, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  for (const [origin, badToken] of [
    ['http://evil.test', token],
    [null, token],
    ['http://127.0.0.1:5173', 'bad'],
  ] as const) {
    const socket = ws('/ws/events', origin, badToken);
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 403);
    socket.terminate();
  }
  const eventSocket = ws('/ws/events');
  const [raw] = await once(eventSocket, 'message');
  const event = JSON.parse(raw.toString());
  assert.equal(event.type, 'state');
  assert.equal(event.data.csrfToken, token);
  eventSocket.close();
  const terminal = ws('/ws/terminal?agentId=missing');
  const [error] = await once(terminal, 'message');
  assert.equal(JSON.parse(error.toString()).type, 'error');
});

test('rejected upgrades release half-open sockets, including stalled response flushes', async (t) => {
  for (const stalled of [false, true]) {
    await t.test(stalled ? 'response flush stalls' : 'response flushes before destruction', async (t) => {
      const { manager } = await fixture(t);
      const address = manager.server.address();
      assert.ok(address && typeof address !== 'string');
      const accepted = once(manager.server, 'connection');
      const peer = connect({ host: '127.0.0.1', port: address.port, allowHalfOpen: true });
      peer.on('error', () => {});
      let transport: Socket | undefined;
      try {
        [transport] = (await accepted) as [Socket];
        if (stalled) t.mock.method(transport, '_write', () => {});
        let response = '';
        peer.on('data', (data) => {
          response += data.toString();
        });
        const received = once(stalled ? manager.server : peer, stalled ? 'upgrade' : 'end', {
          signal: AbortSignal.timeout(5000),
        });
        peer.write(
          'GET /ws/events HTTP/1.1\r\nHost: rejected.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
        );
        await received;
        if (!stalled)
          assert.equal(response, 'HTTP/1.1 403 Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        assert.equal(peer.writableEnded, false);
        const stopped = once(manager.server, 'close', { signal: AbortSignal.timeout(5000) });
        await Promise.all([manager.close(), stopped]);
        assert.equal(transport.destroyed, true);
      } finally {
        transport?.destroy();
        peer.destroy();
      }
    });
  }
});

test('CRUD validates input, preserves omitted credentials, and persists across manager restarts', async (t) => {
  const { api, manager, directory } = await fixture(t);
  assert.equal((await api('/api/agents', 'POST', {})).status, 423);
  const agent = await addAgent(api, 12345);
  assert.equal(
    (
      await api('/api/agents', 'POST', {
        name: 'Bad',
        host: 'localhost',
        username: 'x',
        authType: 'password',
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(`/api/agents/${agent.id}/trust`, 'POST', { fingerprint: 'SHA256:invented' })).status,
    409,
  );
  assert.equal((await api(`/api/agents/${agent.id}`, 'PATCH', { name: 'Renamed' })).status, 200);
  assert.equal(
    (await api(`/api/agents/${agent.id}`, 'PATCH', { model: '  test-model  ', provider: 'custom' })).status,
    200,
  );
  assert.equal((await api(`/api/agents/${agent.id}`, 'PATCH', { model: 'bad\nmodel' })).status, 400);
  const cleared = await api(`/api/agents/${agent.id}`, 'PATCH', { model: '', provider: '' });
  assert.equal(cleared.body.model, '');
  assert.equal(cleared.body.provider, '');
  await api(`/api/agents/${agent.id}`, 'PATCH', { model: '  test-model  ', provider: 'custom' });
  assert.equal((await api(`/api/agents/${agent.id}`, 'PATCH', { authType: 'privateKey' })).status, 400);
  const task = (await api('/api/tasks', 'POST', { title: 'Task', agentId: agent.id, priority: 'high' }))
    .body as Task;
  assert.equal(task.status, 'backlog');
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'running' })).status, 400);
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { report: 'forged' })).status, 400);
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'done' })).status, 200);
  assert.equal((await api('/api/vault/lock', 'POST')).status, 200);
  const locked = (await api('/api/state')).body as AppSnapshot;
  assert.equal(locked.agents[0].hasCredential, true);
  assert.doesNotMatch(JSON.stringify(locked), new RegExp(password));
  await manager.close();
  const reopened = createManager({ dataDir: directory, probeIntervalMs: 60_000 });
  try {
    assert.equal(reopened.snapshot().agents[0].name, 'Renamed');
    assert.equal(reopened.snapshot().agents[0].model, 'test-model');
    assert.equal(reopened.snapshot().agents[0].provider, 'custom');
    assert.equal(reopened.snapshot().tasks[0].status, 'done');
    assert.equal(reopened.snapshot().vault.unlocked, false);
  } finally {
    await reopened.close();
  }
});

test('unknown and changed SSH keys reject BEFORE authentication, and only observed keys can be trusted', async (t) => {
  const remote = await sshFixture(t);
  const { api } = await fixture(t);
  const agent = await addAgent(api, remote.port);
  const response = await api(`/api/agents/${agent.id}/probe`, 'POST');
  assert.equal(response.body.code, 'HOST_KEY_UNTRUSTED');
  assert.equal(response.body.fingerprint, remote.fingerprint);
  assert.equal(remote.auth.length, 0);
  assert.equal(
    (await api(`/api/agents/${agent.id}/trust`, 'POST', { fingerprint: 'SHA256:wrong' })).status,
    409,
  );
  await trustAgent(api, agent, remote.fingerprint);
  assert.ok(remote.auth.includes('password'));
  await remote.close();
  const changed = await sshFixture(t, otherKey, remote.port);
  const mismatch = await api(`/api/agents/${agent.id}/probe`, 'POST');
  assert.equal(mismatch.body.code, 'HOST_KEY_UNTRUSTED');
  assert.equal(mismatch.body.fingerprint, changed.fingerprint);
  assert.equal(changed.auth.length, 0);
  const state = (await api('/api/state')).body as AppSnapshot;
  assert.equal(state.agents[0].fingerprint, remote.fingerprint);
  assert.equal(state.agents[0].status, 'offline');
  assert.equal(
    (await api(`/api/agents/${agent.id}/trust`, 'POST', { fingerprint: remote.fingerprint })).status,
    409,
  );
  assert.equal((await api(`/api/agents/${agent.id}`, 'PATCH', { host: 'localhost' })).status, 200);
  assert.equal(((await api('/api/state')).body as AppSnapshot).agents[0].fingerprint, undefined);
  assert.equal(
    (await api(`/api/agents/${agent.id}/trust`, 'POST', { fingerprint: changed.fingerprint })).status,
    409,
  );
});

test('real SSH task streams logs, sends prompt via stdin without PTY, enforces exclusivity, and finishes in review', async (t) => {
  const remote = await sshFixture(t);
  const { api, ws } = await fixture(t);
  const agent = await addAgent(api, remote.port);
  await trustAgent(api, agent, remote.fingerprint);
  const socket = ws('/ws/events');
  const messages: any[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  const description = "Please review this; $(touch never) ' quoted\nsecond line";
  const task = (await api('/api/tasks', 'POST', { title: 'Real SSH run', description, agentId: agent.id }))
    .body as Task;
  const second = (await api('/api/tasks', 'POST', { title: 'Second', agentId: agent.id })).body as Task;
  const launched = await api(`/api/tasks/${task.id}/run`, 'POST');
  assert.equal(launched.status, 202);
  assert.equal(launched.body.status, 'running');
  for (const path of [
    `/api/tasks/${task.id}/run`,
    `/api/tasks/${second.id}/run`,
    `/api/agents/${agent.id}/probe`,
    '/api/vault/lock',
  ])
    assert.equal((await api(path, 'POST')).status, 409);
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'done' })).status, 409);
  assert.equal((await api(`/api/tasks/${task.id}`, 'DELETE')).status, 409);
  assert.equal((await api(`/api/agents/${agent.id}`, 'DELETE')).status, 409);
  const final = await waitFor(
    async () => (await api('/api/state')).body as AppSnapshot,
    (state) => state.tasks.find((item) => item.id === task.id)?.status !== 'running',
  );
  const completed = final.tasks.find((item) => item.id === task.id)!;
  assert.equal(completed.status, 'review', completed.error);
  assert.equal(completed.report, 'Final report [redacted]');
  assert.equal(completed.sessionId, 'session-final');
  assert.equal(completed.exitCode, 0);
  assert.deepEqual(remote.prompts, [description]);
  assert.equal(remote.ptys, 0);
  assert.equal(remote.commands.at(-1), hermesCommand(agent, 'run'));
  const logs = (await api(`/api/tasks/${task.id}/logs`)).body;
  assert.ok(logs.some((entry: { text: string }) => entry.text === 'Hello there'));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(password));
  assert.ok(messages.some((message) => message.type === 'log' && message.data.taskId === task.id));
  assert.ok(
    messages.some(
      (message) =>
        message.type === 'state' && message.data.tasks.some((item: Task) => item.status === 'running'),
    ),
  );
  assert.equal((await api(`/api/agents/${agent.id}`, 'DELETE')).status, 200);
  assert.equal(
    ((await api('/api/state')).body as AppSnapshot).tasks.find((item) => item.id === task.id)?.agentId,
    null,
  );
  assert.ok((await api(`/api/tasks/${task.id}/logs`)).body.length);
});

test('failed results, missing results, disconnects, and deadlines never claim success or cancellation', async (t) => {
  const remote = await sshFixture(t);
  const { api } = await fixture(t, 800);
  const agent = await addAgent(api, remote.port);
  await trustAgent(api, agent, remote.fingerprint);
  for (const mode of ['failure', 'no-result', 'disconnect', 'hang'] as const) {
    remote.mode = mode;
    const task = (await api('/api/tasks', 'POST', { title: mode, agentId: agent.id })).body as Task;
    assert.equal((await api(`/api/tasks/${task.id}/run`, 'POST')).status, 202);
    const state = await waitFor(
      async () => (await api('/api/state')).body as AppSnapshot,
      (state) => state.tasks.find((item) => item.id === task.id)?.status === 'blocked',
    );
    const final = state.tasks.find((item) => item.id === task.id)!;
    assert.equal(final.status, 'blocked');
    if (mode === 'failure') assert.match(final.error!, /Hermes test failure/);
    else assert.match(final.error!, /unknown/);
  }
});

test('capability mismatch is online but not runnable; terminal uses PTY and closes the SSH channel with the socket', async (t) => {
  const remote = await sshFixture(t);
  const { api, ws } = await fixture(t);
  const agent = await addAgent(api, remote.port);
  await trustAgent(api, agent, remote.fingerprint);
  remote.help = '--old-option';
  const probe = await api(`/api/agents/${agent.id}/probe`, 'POST');
  assert.equal(probe.body.code, 'HERMES_UNSUPPORTED');
  assert.equal(((await api('/api/state')).body as AppSnapshot).agents[0].status, 'online');
  const task = (await api('/api/tasks', 'POST', { title: 'Unsupported', agentId: agent.id })).body as Task;
  assert.equal((await api(`/api/tasks/${task.id}/run`, 'POST')).body.code, 'HERMES_CHECK_REQUIRED');
  const socket = ws(`/ws/terminal?agentId=${agent.id}`);
  const messages: any[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await waitFor(
    async () => messages,
    (values) => values.some((value) => value.type === 'status' && value.status === 'connected'),
  );
  assert.equal(remote.ptys, 1);
  assert.equal((await api('/api/vault/lock', 'POST')).status, 409);
  assert.equal((await api(`/api/agents/${agent.id}`, 'DELETE')).status, 409);
  socket.send(JSON.stringify({ type: 'input', data: 'hello\n' }));
  socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
  await waitFor(
    async () => messages,
    (values) => values.some((value) => value.type === 'output' && value.data.includes('echo:hello')),
  );
  await waitFor(
    async () => remote.resizes,
    (values) => values.some((value) => value.cols === 120 && value.rows === 40),
  );
  socket.close();
  await waitFor(async () => remote.terminalClosed, Boolean);
  await waitFor(
    () => api('/api/vault/lock', 'POST'),
    (value) => value.status === 200,
  );
  const locked = ws(`/ws/terminal?agentId=${agent.id}`);
  const [raw] = await once(locked, 'message');
  assert.match(JSON.parse(raw.toString()).message, /Unlock the vault/);
});

test('SSH cleanup destroys transports even when the peer stops reading', async (t) => {
  for (const operation of ['probe', 'run', 'terminal', 'shutdown'] as const) {
    await t.test(operation, async (t) => {
      const clients: Client[] = [];
      const closed = new Set<Client>();
      const originalConnect = ssh2.Client.prototype.connect;
      t.mock.method(ssh2.Client.prototype, 'connect', function (this: Client, config: ConnectConfig) {
        clients.push(this);
        this.once('close', () => closed.add(this));
        return originalConnect.call(this, config);
      });
      const remote = await sshFixture(t);
      const { api, ws, manager } = await fixture(t);
      const agent = await addAgent(api, remote.port);
      await trustAgent(api, agent, remote.fingerprint);
      await waitFor(async () => clients.every((client) => closed.has(client)), Boolean);
      const before = clients.length;
      remote.stallCleanup = true;
      if (operation === 'probe') {
        assert.equal((await api(`/api/agents/${agent.id}/probe`, 'POST')).status, 200);
      } else if (operation === 'run') {
        const task = (
          await api('/api/tasks', 'POST', { title: 'Complete before teardown', agentId: agent.id })
        ).body as Task;
        assert.equal((await api(`/api/tasks/${task.id}/run`, 'POST')).status, 202);
        const final = await waitFor(
          async () => manager.snapshot().tasks.find((value) => value.id === task.id)!,
          (value) => value.status !== 'running',
        );
        assert.equal(final.status, 'review', final.error);
        assert.equal(final.report, 'Final report [redacted]');
        assert.equal(final.exitCode, 0);
      } else {
        const socket = ws(`/ws/terminal?agentId=${agent.id}`);
        let connected = false;
        socket.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'status' && message.status === 'connected') connected = true;
        });
        await waitFor(async () => connected, Boolean);
        if (operation === 'shutdown') await manager.close();
        else socket.close();
      }
      assert.equal(clients.length, before + 1);
      await waitFor(async () => closed.has(clients.at(-1)!), Boolean);
      if (operation !== 'shutdown') assert.equal((await api('/api/vault/lock', 'POST')).status, 200);
    });
  }
});

test('production SPA fallback works with Express 5 and configured ports replace the default authority', async (t) => {
  const staticDir = mkdtempSync(join(tmpdir(), 'hermes-dist-'));
  t.after(() => rmSync(staticDir, { recursive: true, force: true }));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Test UI</title>');
  const { api } = await fixture(t, 5000, { staticDir, port: 4799 });
  for (const route of ['/', '/board/task/example']) {
    const response = await api(route);
    assert.equal(response.status, 200);
    assert.match(response.body, /Test UI/);
  }
  assert.equal((await api('/api/missing')).status, 404);
  assert.equal((await api('/api/state', 'GET', undefined, { Host: 'localhost:4310' })).status, 403);
  assert.equal((await api('/api/state', 'GET', undefined, { Origin: 'http://localhost:4310' })).status, 403);
  assert.equal(
    (await api('/api/state', 'GET', undefined, { Host: 'localhost:4799', Origin: 'http://localhost:4799' }))
      .status,
    200,
  );
});

test('periodic checks skip locked vaults, untrusted agents, pending keys, and active runs', async (t) => {
  const remote = await sshFixture(t);
  const { api } = await fixture(t, 2000, { probeIntervalMs: 100 });
  const agent = await addAgent(api, remote.port);
  await delay(150);
  assert.equal(remote.auth.length, 0);
  await trustAgent(api, agent, remote.fingerprint);
  await waitFor(
    async () => remote.commands.length,
    (count) => count >= 4,
  );
  await waitFor(
    () => api('/api/vault/lock', 'POST'),
    (response) => response.status === 200,
  );
  const count = remote.commands.length;
  await delay(200);
  assert.equal(remote.commands.length, count);
  assert.equal((await api('/api/vault/unlock', 'POST', { passphrase })).status, 200);
  remote.mode = 'hang';
  const task = (await api('/api/tasks', 'POST', { title: 'Do not overlap checks', agentId: agent.id }))
    .body as Task;
  await waitFor(
    () => api(`/api/tasks/${task.id}/run`, 'POST'),
    (response) => response.status === 202,
  );
  await waitFor(
    async () => remote.prompts.length,
    (count) => count === 1,
  );
  const whileRunning = remote.commands.length;
  await delay(250);
  assert.equal(remote.commands.length, whileRunning);
});

test('coding runners run in the task folder, wait for answers, and resume the same session on reply', async (t) => {
  const remote = await sshFixture(t);
  const { api } = await fixture(t);
  const agent = await addAgent(api, remote.port);
  await trustAgent(api, agent, remote.fingerprint);
  const checked = ((await api('/api/state')).body as AppSnapshot).agents.find((a) => a.id === agent.id)!;
  assert.equal(checked.tools?.claude?.path, '/opt/bin/claude');
  assert.equal(checked.tools?.opencode, undefined);
  const task = (
    await api('/api/tasks', 'POST', {
      title: 'Migrate',
      description: 'Migrate the schemas',
      agentId: agent.id,
      runner: 'claude',
      workdir: '/work/repo dir',
    })
  ).body as Task;
  assert.equal((await api(`/api/tasks/${task.id}/reply`, 'POST', { message: 'too early' })).status, 409);
  assert.equal((await api(`/api/tasks/${task.id}/run`, 'POST')).status, 202);
  const read = async () =>
    ((await api('/api/state')).body as AppSnapshot).tasks.find((item) => item.id === task.id)!;
  const waiting = await waitFor(read, (item) => item.status !== 'running');
  assert.equal(waiting.status, 'waiting', waiting.error);
  assert.equal(waiting.waitingReason, 'Should I migrate both of them?');
  assert.equal(waiting.sessionId, 'claude-session');
  assert.equal(
    remote.commands.at(-1),
    `cd '/work/repo dir' && PATH='/opt/bin':"$PATH" '/opt/bin/claude' '-p' '--output-format' 'stream-json' '--verbose' '--permission-mode' 'acceptEdits'`,
  );
  assert.equal(remote.prompts.at(-1), 'Migrate the schemas');
  assert.equal((await api(`/api/tasks/${task.id}/reply`, 'POST', { message: 'Yes, both.' })).status, 202);
  const done = await waitFor(read, (item) => item.status !== 'running');
  assert.equal(done.status, 'review', done.error);
  assert.equal(done.report, 'Migration finished.');
  assert.equal(done.waitingReason, undefined);
  assert.ok(remote.commands.at(-1)!.endsWith("'--resume' 'claude-session'"));
  assert.equal(remote.prompts.at(-1), 'Yes, both.');
  assert.deepEqual(
    done.turns?.map((turn) => turn.role),
    ['user', 'agent', 'user', 'agent'],
  );
  const logs = (await api(`/api/tasks/${task.id}/logs`)).body;
  assert.ok(logs.some((entry: { text: string }) => entry.text === 'Looking around'));
});

test('global and per-agent models resolve in order, and soft edits keep the agent checked', async (t) => {
  const remote = await sshFixture(t);
  const { api } = await fixture(t);
  const agent = await addAgent(api, remote.port);
  await trustAgent(api, agent, remote.fingerprint);
  assert.equal((await api('/api/defaults', 'PUT', { model: 'global-model', provider: 'nous' })).status, 200);
  const run = async () => {
    const task = (await api('/api/tasks', 'POST', { title: 'Model check', agentId: agent.id })).body as Task;
    assert.equal((await api(`/api/tasks/${task.id}/run`, 'POST')).status, 202);
    await waitFor(
      async () => ((await api('/api/state')).body as AppSnapshot).tasks.find((item) => item.id === task.id)!,
      (item) => item.status !== 'running',
    );
    return remote.commands.at(-1)!;
  };
  assert.ok((await run()).includes("'--model' 'global-model' '--provider' 'nous'"));
  const bulk = await api('/api/agents/bulk', 'POST', {
    ids: [agent.id],
    model: 'own-model',
    provider: 'openrouter',
  });
  assert.equal(bulk.status, 200);
  assert.ok((await run()).includes("'--model' 'own-model' '--provider' 'openrouter'"));
  const recolored = await api(`/api/agents/${agent.id}`, 'PATCH', {
    color: 'violet',
    model: '',
    provider: '',
  });
  assert.equal(recolored.status, 200);
  assert.equal(recolored.body.status, 'online');
  assert.ok((await run()).includes("'--model' 'global-model'"));
  assert.equal(
    (await api('/api/agents/bulk', 'POST', { ids: ['not-a-uuid'], model: '', provider: '' })).status,
    400,
  );
});

test('removing an agent pauses its schedules instead of retrying forever', async (t) => {
  const { api } = await fixture(t);
  assert.equal((await api('/api/vault/unlock', 'POST', { passphrase })).status, 200);
  const agent = (
    await api('/api/agents', 'POST', {
      transport: 'local',
      name: 'Doomed',
      host: 'localhost',
      port: 22,
      username: 'local',
      authType: 'password',
      hermesPath: process.execPath,
      workdir: '',
      profile: '',
    })
  ).body as Agent;
  assert.ok(agent.color);
  const schedule = await api('/api/schedules', 'POST', {
    title: 'Nightly',
    agentId: agent.id,
    nextRun: new Date(Date.now() + 3_600_000).toISOString(),
    intervalMinutes: 60,
    enabled: true,
  });
  assert.equal(schedule.status, 201);
  assert.equal((await api(`/api/agents/${agent.id}`, 'DELETE')).status, 200);
  const state = (await api('/api/state')).body as AppSnapshot;
  assert.equal(state.schedules[0].enabled, false);
  assert.match(state.schedules[0].lastError ?? '', /was removed/);
  assert.equal((await api(`/api/schedules/${schedule.body.id}`, 'PATCH', { enabled: true })).status, 409);
  assert.equal((await api('/api/schedules/00000000-0000-4000-8000-000000000000', 'DELETE')).status, 404);
});
