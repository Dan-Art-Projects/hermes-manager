import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, Vault, seal, unseal, secretRedactor, type VaultRecord } from '../server/vault.ts';
import { JsonLines, hermesArgs, hermesCommand, quote } from '../server/ssh.ts';
import { Store, LOG_LIMIT, LOG_TEXT_LIMIT } from '../server/store.ts';
import type { Agent, Task } from '../shared/types.ts';

test('AES-GCM authenticates ciphertext, tag, IV, and agent-specific context', () => {
  const key = randomBytes(32);
  const encrypted = seal(key, 'private credential', 'agent:a');
  assert.equal(unseal(key, encrypted, 'agent:a'), 'private credential');
  assert.notEqual(encrypted.iv, seal(key, 'private credential', 'agent:a').iv);
  assert.throws(() => unseal(key, encrypted, 'agent:b'));
  for (const field of ['ciphertext', 'tag', 'iv'] as const) {
    const bytes = Buffer.from(encrypted[field], 'base64');
    bytes[0] ^= 1;
    assert.throws(() => unseal(key, { ...encrypted, [field]: bytes.toString('base64') }, 'agent:a'));
  }
  assert.throws(() => unseal(randomBytes(32), encrypted, 'agent:a'));
});

test('vault initializes once, unlocks asynchronously, rejects wrong passwords, throttles, and never persists its key', async () => {
  let record: VaultRecord | undefined;
  const persistence = {
    readVault: () => record,
    writeVault: (value: VaultRecord) => {
      assert.equal(record, undefined);
      record = value;
    },
  };
  const vault = new Vault(persistence);
  assert.deepEqual(vault.state, { configured: false, unlocked: false });
  await assert.rejects(vault.unlock('too short'), { status: 400 });
  const unlocking = vault.unlock('correct horse battery staple');
  await assert.rejects(vault.unlock('another valid passphrase'), { status: 429 });
  await unlocking;
  const credentials = { password: 'not saved in plaintext' };
  const encrypted = vault.encrypt('agent-a', credentials);
  assert.deepEqual(vault.decrypt('agent-a', encrypted), credentials);
  assert.throws(() => vault.decrypt('agent-b', encrypted), { code: 'CREDENTIAL_DAMAGED' });
  assert.doesNotMatch(JSON.stringify(record), /correct horse|not saved|"key"/);
  vault.lock();
  assert.throws(() => vault.decrypt('agent-a', encrypted), { status: 423 });
  await assert.rejects(vault.unlock('incorrect password here'), { code: 'VAULT_UNLOCK_FAILED' });
  await assert.rejects(vault.unlock('correct horse battery staple'), { status: 429 });
  const reopened = new Vault(persistence);
  await reopened.unlock('correct horse battery staple');
  assert.deepEqual(reopened.decrypt('agent-a', encrypted), credentials);
  reopened.dispose();
  await assert.rejects(reopened.unlock('correct horse battery staple'), { status: 503 });
  assert.equal(vault.state.unlocked, false);
});

test('damaged vault verifier cannot unlock', async () => {
  let record: VaultRecord | undefined;
  const persistence = {
    readVault: () => record,
    writeVault: (value: VaultRecord) => {
      record = value;
    },
  };
  const vault = new Vault(persistence);
  await vault.unlock('a long test passphrase');
  vault.lock();
  record!.verifier.tag = randomBytes(16).toString('base64');
  await assert.rejects(
    vault.unlock('a long test passphrase'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

test('all Hermes arguments are POSIX quoted; prompt is never part of a command', () => {
  assert.equal(quote("a'b; $(touch /tmp/nope)"), "'a'\\''b; $(touch /tmp/nope)'");
  assert.equal(quote(''), "''");
  assert.throws(() => quote('bad\0argument'));
  const command = hermesCommand(
    { hermesPath: '/opt/my bin/hermes', profile: "it's prod;$(id)", workdir: '/work/a b' },
    'run',
  );
  assert.equal(
    command,
    "'/opt/my bin/hermes' '-p' 'it'\\''s prod;$(id)' 'chat' '--in' '/work/a b' '--oneshot' '--query-file' '-' '--format' 'stream-json'",
  );
  assert.equal(
    hermesCommand({ hermesPath: '', profile: '', workdir: '' }, 'version'),
    "'hermes' '--version'",
  );
  assert.doesNotMatch(command, /--yolo|--query'/);
});

test('model overrides apply only to runs and blank settings inherit Hermes defaults', () => {
  const agent = {
    hermesPath: 'hermes',
    profile: '',
    workdir: '',
    model: "model's;$(id)",
    provider: 'custom',
  };
  const args = hermesArgs(agent, 'run');
  assert.equal(args[args.indexOf('--model') + 1], agent.model);
  assert.equal(args[args.indexOf('--provider') + 1], agent.provider);
  assert.ok(hermesCommand(agent, 'run').includes(quote(agent.model)));
  assert.deepEqual(hermesArgs(agent, 'help'), ['chat', '--help']);
  assert.deepEqual(hermesArgs(agent, 'version'), ['--version']);
  assert.ok(!hermesArgs({ ...agent, model: '', provider: '' }, 'run').includes('--model'));
  assert.ok(!hermesArgs({ ...agent, model: '', provider: '' }, 'run').includes('--provider'));
});

test('JSONL handles partial UTF-8, official text.text events, CRLF, final tails, and oversized lines', () => {
  const lines: { event: unknown; raw: string }[] = [];
  let oversized = 0;
  const parser = new JsonLines(
    (event, raw) => lines.push({ event, raw }),
    () => oversized++,
    100,
  );
  const input = Buffer.from(
    '{"type":"text","text":"caf\u00e9"}\r\nnot json\n{"type":"result","exit_code":0,"text":"done"}',
  );
  for (const byte of input) parser.write(Buffer.from([byte]));
  parser.end();
  assert.deepEqual(lines[0].event, { type: 'text', text: 'caf\u00e9' });
  assert.equal(lines[1].event, undefined);
  assert.deepEqual(lines[2].event, { type: 'result', exit_code: 0, text: 'done' });
  assert.equal(oversized, 0);
  const bounded: string[] = [];
  const limited = new JsonLines(
    (_event, raw) => bounded.push(raw),
    () => oversized++,
    16,
  );
  limited.write(Buffer.from('x'.repeat(17)));
  limited.write(Buffer.from('y'.repeat(10000)));
  limited.write(Buffer.from('\n{"ok":true}\n'));
  limited.end();
  assert.equal(oversized, 1);
  assert.deepEqual(bounded, ['{"ok":true}']);
});

test('credential redaction covers passwords, passphrases, and private-key body lines', () => {
  const redact = secretRedactor({
    password: 'my password',
    passphrase: 'keyphrase',
    privateKey: '-----BEGIN PRIVATE KEY-----\nsecret-base64-line\n-----END PRIVATE KEY-----',
  });
  assert.equal(redact('my password keyphrase secret-base64-line'), '[redacted] [redacted] [redacted]');
  const stream = secretRedactor({ password: 'sensitive\\password' }, true);
  const output = stream('message sens') + stream('itive\\pass') + stream('word end') + stream('', true);
  assert.equal(output, 'message [redacted] end');
  assert.equal(
    secretRedactor({ password: 'sensitive\\password' })(JSON.stringify({ text: 'sensitive\\password' })),
    '{"text":"[redacted]"}',
  );
});

test('SQLite persists CRUD, caps logs, recovers unknown runs, and unassigns historical tasks on agent deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hermes-store-'));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    const vault = new Vault(store);
    await vault.unlock('store test passphrase');
    const id = randomUUID();
    const agent: Agent = {
      id,
      name: 'Test',
      host: 'localhost',
      port: 22,
      username: 'tester',
      authType: 'password',
      hermesPath: 'hermes',
      profile: '',
      workdir: '',
      status: 'busy',
      hasCredential: true,
      createdAt: new Date().toISOString(),
    };
    store.saveAgent(agent, vault.encrypt(id, { password: 'highly-specific-test-password' }));
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: 'Interrupted task',
      description: '',
      agentId: id,
      status: 'running',
      priority: 'high',
      createdAt: now,
      updatedAt: now,
    };
    store.saveTask(task);
    assert.throws(() => new Store(directory), /database is locked/);
    assert.equal(store.task(task.id)?.status, 'running');
    for (let i = 0; i < LOG_LIMIT + 5; i++) store.addLog(task.id, 'stdout', `record ${i}`);
    store.addLog(task.id, 'stderr', 'x'.repeat(LOG_TEXT_LIMIT * 2));
    assert.equal(store.logs(task.id).length, LOG_LIMIT);
    assert.ok(store.logs(task.id).at(-1)!.text.length <= LOG_TEXT_LIMIT);
    vault.dispose();
    store.close();
    store = new Store(directory);
    assert.equal(store.agent(id)?.status, 'unknown');
    assert.equal(store.task(task.id)?.status, 'blocked');
    assert.match(store.task(task.id)!.error!, /unknown/);
    assert.equal(store.task(task.id)?.finishedAt, undefined);
    const reopened = new Vault(store);
    assert.equal(reopened.state.unlocked, false);
    await reopened.unlock('store test passphrase');
    assert.deepEqual(reopened.decrypt(id, store.credential(id)), {
      password: 'highly-specific-test-password',
    });
    store.deleteAgent(id);
    assert.equal(store.task(task.id)?.agentId, null);
    assert.ok(store.logs(task.id).length);
    store.deleteTask(task.id);
    assert.deepEqual(store.logs(task.id), []);
    reopened.dispose();
    store.close();
    store = undefined;
    for (const name of readdirSync(directory))
      assert.equal(
        readFileSync(join(directory, name)).includes(Buffer.from('highly-specific-test-password')),
        false,
      );
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
