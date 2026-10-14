import test from 'node:test';
import assert from 'node:assert/strict';
import {
  needsInput,
  parseToolDetection,
  runners,
  toolDetectionScript,
  type Invocation,
} from '../server/runners.ts';
import { quote, runAgent, shellCommand } from '../server/ssh.ts';
import { effectiveModel, effectiveToolModel, type Agent } from '../shared/types.ts';

const agent: Agent = {
  id: 'a',
  name: 'Agent',
  transport: 'ssh',
  host: 'h',
  port: 22,
  username: 'u',
  authType: 'password',
  hermesPath: 'hermes',
  workdir: '~/projects',
  profile: '',
  status: 'online',
  hasCredential: true,
  createdAt: new Date().toISOString(),
  tools: {
    claude: { path: '/home/u/.local/bin/claude', version: '2' },
    codex: { path: '/home/u/.nvm/versions/node/v22/bin/codex', version: '0.5' },
    opencode: { path: '/usr/local/bin/opencode', version: '1' },
  },
};
const context = { prompt: "fix it; $(rm -rf /) '", workdir: '~/projects/app', model: '', provider: '' };

/** Feeds canned lines through a runner's parser the way runAgent does. */
function parse(runner: keyof typeof runners, lines: unknown[], exitCode = 0) {
  const parser = runners[runner].parser();
  let session: string | undefined;
  const logs: string[] = [];
  for (const line of lines) {
    const raw = typeof line === 'string' ? line : JSON.stringify(line);
    const event = typeof line === 'string' ? undefined : (line as Record<string, unknown>);
    const parsed = parser.event(event, raw);
    session = parsed.session ?? session;
    if (parsed.log) logs.push(parsed.log);
  }
  return { ...parser.outcome(exitCode, false), session, logs };
}

test('model resolution: agent pair, then global, then the CLI default', () => {
  const defaults = { model: 'g', provider: 'nous', tools: { codex: 'gpt-g' } };
  assert.deepEqual(effectiveModel({ model: 'm', provider: '' }, defaults), {
    model: 'm',
    provider: '',
    source: 'agent',
  });
  assert.deepEqual(effectiveModel({}, defaults), { model: 'g', provider: 'nous', source: 'global' });
  assert.equal(effectiveModel({}, { model: '', provider: '' }).source, 'default');
  assert.equal(effectiveToolModel({ toolModels: { codex: 'mine' } }, defaults, 'codex'), 'mine');
  assert.equal(effectiveToolModel({}, defaults, 'codex'), 'gpt-g');
  assert.equal(effectiveToolModel({}, defaults, 'claude'), '');
});

test('coding runner commands keep the prompt out of the shell and quote everything', () => {
  const claude = runners.claude.build(agent, { ...context, model: 'opus', resume: 'sess 1' });
  assert.equal(claude.stdin, context.prompt);
  assert.ok(!claude.argv.includes(context.prompt));
  assert.deepEqual(claude.argv.slice(-4), ['--model', 'opus', '--resume', 'sess 1']);
  assert.equal(
    shellCommand(claude),
    `cd ~/'projects/app' && PATH='/home/u/.local/bin':"$PATH" '/home/u/.local/bin/claude' '-p' '--output-format' 'stream-json' '--verbose' '--permission-mode' 'acceptEdits' '--model' 'opus' '--resume' 'sess 1'`,
  );
  const codex = runners.codex.build(agent, { ...context, model: 'gpt-5', resume: 'thread-9' });
  assert.deepEqual(codex.argv.slice(1), [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '--skip-git-repo-check',
    '-m',
    'gpt-5',
    'resume',
    'thread-9',
    '-',
  ]);
  assert.equal(codex.pathDir, '/home/u/.nvm/versions/node/v22/bin');
  // opencode takes the message as an argument, so it must be a single quoted word after --.
  const opencode = runners.opencode.build(agent, { ...context, model: 'nous/hermes-4' });
  assert.deepEqual(opencode.argv.slice(-4), ['-m', 'nous/hermes-4', '--', context.prompt]);
  assert.ok(shellCommand(opencode).endsWith(` '--' ${quote(context.prompt)}`));
  assert.throws(() => runners.claude.build({ ...agent, tools: {} }, context), /not found/);
  assert.equal(
    runners.claude.build({ ...agent, toolPaths: { claude: '/opt/claude' } }, context).argv[0],
    '/opt/claude',
  );
});

test('hermes resume is only offered when the installed Hermes supports it', () => {
  const plain = runners.hermes.build(agent, { ...context, resume: undefined });
  assert.ok(!plain.argv.includes('--resume'));
  assert.equal(plain.cwd, undefined);
  assert.equal(runners.hermes.canResume(agent), false);
  assert.equal(runners.hermes.canResume({ ...agent, resume: true }), true);
  assert.ok(runners.hermes.build(agent, { ...context, resume: 's' }).argv.includes('--resume'));
});

test('claude parser reports permission denials as waiting', () => {
  const outcome = parse('claude', [
    { type: 'system', subtype: 'init', session_id: 'c1' },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Could not run the tests.',
      session_id: 'c1',
      permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'Bash' }],
    },
  ]);
  assert.equal(outcome.success, true);
  assert.equal(outcome.session, 'c1');
  assert.match(outcome.waiting!, /not allowed to use Bash\./);
  assert.match(outcome.logs[0], /^→ Bash/);
  const failed = parse('claude', [{ type: 'result', subtype: 'error_max_turns', is_error: true }], 1);
  assert.equal(failed.success, false);
  assert.match(failed.error!, /error_max_turns/);
  assert.match(parse('claude', [], 0).error!, /could not be verified/);
});

test('codex parser handles current and legacy event shapes', () => {
  const current = parse('codex', [
    { type: 'thread.started', thread_id: 't1' },
    { type: 'item.started', item: { type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'ok', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'All tests pass.' } },
    { type: 'turn.completed', usage: {} },
  ]);
  assert.deepEqual([current.success, current.session, current.report], [true, 't1', 'All tests pass.']);
  assert.ok(current.logs.includes('$ npm test'));
  const failed = parse('codex', [
    { type: 'thread.started', thread_id: 't2' },
    { type: 'turn.failed', error: { message: 'rate limited' } },
  ]);
  assert.deepEqual([failed.success, failed.error], [false, 'rate limited']);
  const legacy = parse('codex', [
    { id: '0', msg: { type: 'session_configured', session_id: 'old' } },
    { id: '1', msg: { type: 'task_complete', last_agent_message: 'Done.' } },
  ]);
  assert.deepEqual([legacy.success, legacy.session, legacy.report], [true, 'old', 'Done.']);
  assert.equal(parse('codex', [{ type: 'thread.started', thread_id: 'x' }]).success, false);
});

test('opencode parser keeps the final step text and falls back to plain output', () => {
  const outcome = parse('opencode', [
    { type: 'step_start', sessionID: 'ses_1' },
    { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'Let me look.' } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'read', state: { status: 'completed' } } },
    { type: 'step_finish', sessionID: 'ses_1' },
    { type: 'step_start', sessionID: 'ses_1' },
    { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'Fixed the bug.' } },
    { type: 'step_finish', sessionID: 'ses_1' },
  ]);
  assert.deepEqual([outcome.success, outcome.session, outcome.report], [true, 'ses_1', 'Fixed the bug.']);
  assert.ok(outcome.logs.includes('→ read completed'));
  const plain = parse('opencode', ['Plain answer', 'second line']);
  assert.equal(plain.report, 'Plain answer\nsecond line');
  const error = parse(
    'opencode',
    [{ type: 'error', error: { name: 'ProviderAuthError', data: { message: 'no key' } } }],
    1,
  );
  assert.deepEqual([error.success, error.error], [false, 'no key']);
});

test('needsInput spots questions handed back to the human, not polite closers', () => {
  assert.equal(needsInput('Done.\n\nShould I also update the docs?'), 'Should I also update the docs?');
  assert.equal(
    needsInput('Two options:\n- A\n- B\n\nPlease confirm which one to use.'),
    'Please confirm which one to use.',
  );
  assert.equal(needsInput('All finished. Tests pass.'), undefined);
  assert.equal(needsInput('Finished.\n\nLet me know if you have any questions?'), undefined);
  assert.equal(needsInput('Finished.\n\nAnything else?'), undefined);
  assert.equal(needsInput('What does `foo?` mean was answered in the README.'), undefined);
  assert.equal(needsInput(undefined), undefined);
});

test('tool detection script is valid POSIX and its output parses', () => {
  const script = toolDetectionScript(quote, { codex: "/opt/it's/codex" });
  assert.ok(script.includes(`p=${quote("/opt/it's/codex")}`));
  assert.ok(script.includes('command -v claude'));
  assert.deepEqual(
    parseToolDetection(
      'claude\t/u/bin/claude\t2.0.1 (Claude Code)\r\ncodex\t\t\nopencode\t/x/opencode\t\nbogus\t/a\t1\n',
    ),
    { claude: { path: '/u/bin/claude', version: '2.0.1 (Claude Code)' } },
  );
});

test('runAgent streams a local coding CLI and maps its outcome', async () => {
  const script = [
    'let input = "";',
    'process.stdin.on("data", (d) => (input += d));',
    'process.stdin.on("end", () => {',
    '  console.log(JSON.stringify({ type: "thread.started", thread_id: "local-thread" }));',
    '  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Echo: " + input + "\\n\\nWould you like me to commit?" } }));',
    '  console.log(JSON.stringify({ type: "turn.completed" }));',
    '});',
  ].join('\n');
  const local: Agent = { ...agent, transport: 'local', workdir: process.cwd() };
  const invocation: Invocation = { argv: [process.execPath, '-e', script], stdin: 'hello' };
  const sessions: string[] = [];
  const logs: string[] = [];
  const outcome = await runAgent(
    undefined,
    local,
    invocation,
    runners.codex.parser(),
    new AbortController().signal,
    (_stream, text) => logs.push(text),
    (id) => sessions.push(id),
  );
  assert.equal(outcome.success, true, outcome.error);
  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(sessions, ['local-thread']);
  assert.equal(needsInput(outcome.report), 'Would you like me to commit?');
  assert.match(outcome.report!, /^Echo: hello/);
});
