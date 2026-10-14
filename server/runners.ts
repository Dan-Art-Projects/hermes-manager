import { posix } from 'node:path';
import type { Agent, CodingTool, Runner } from '../shared/types.ts';
import type { JsonEvent } from './ssh.ts';

/** One process launch: argv[0] is the executable. The prompt goes to stdin unless the runner embeds it. */
export interface Invocation {
  argv: string[];
  stdin: string;
  /** Working directory. SSH uses `cd`; local spawns use it as cwd. */
  cwd?: string;
  /** Prepended to PATH so node-based CLIs installed under nvm/volta find their interpreter. */
  pathDir?: string;
}

export interface RunContext {
  prompt: string;
  /** Session to continue, when the runner supports it. */
  resume?: string;
  workdir: string;
  model: string;
  provider: string;
}

export interface ParsedOutcome {
  success: boolean;
  report?: string;
  sessionId?: string;
  error?: string;
  /** Set when the agent stopped because it needs a human decision. */
  waiting?: string;
}

export interface StreamParser {
  /** Returns the text worth logging (or undefined to skip) and any session id seen. */
  event(event: JsonEvent | undefined, raw: string): { log?: string; session?: string };
  outcome(exitCode: number | undefined, protocolError: boolean): ParsedOutcome;
}

export interface RunnerSpec {
  build(agent: Agent, context: RunContext): Invocation;
  parser(): StreamParser;
  /** Whether a follow-up can continue the previous session for this agent. */
  canResume(agent: Agent): boolean;
}

const REPORT_LIMIT = 128 * 1024;
const unverified =
  'Completion could not be verified. Remote outcome is unknown; inspect the host before retrying.';
const clip = (text: string) =>
  text.length > REPORT_LIMIT ? `${text.slice(0, REPORT_LIMIT)}\n[Report truncated]` : text;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const obj = (value: unknown): JsonEvent | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonEvent) : undefined;
const brief = (value: unknown, max = 300) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const closers = /^(is there )?anything else\b|^let me know if\b|^(any|other) questions\b/i;
const asks =
  /\b(please (confirm|advise|choose|decide)|awaiting your|need(s)? your (input|approval|confirmation|decision)|waiting (for|on) your|which (option|approach) (would|do) you)\b/i;

/** Detects a final message that hands a question back to the human. */
export function needsInput(text: string | undefined): string | undefined {
  const paragraphs = text?.trim().split(/\n\s*\n/) ?? [];
  const last = paragraphs.at(-1)?.trim();
  if (!last) return undefined;
  const tail = last.split('\n').at(-1)!.trim();
  if (closers.test(tail.replace(/^[-*>\s]+/, ''))) return undefined;
  if (/\?[\s"')*_`]*$/.test(tail) || asks.test(last)) return brief(tail, 400);
  return undefined;
}

function hermesParser(): StreamParser {
  let result: JsonEvent | undefined;
  let duplicate = false;
  return {
    event(event, raw) {
      let session: string | undefined;
      if (event?.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string')
        session = event.session_id;
      if (event?.type === 'result') {
        if (result) duplicate = true;
        result = event;
      }
      return { session, log: event?.type === 'text' && typeof event.text === 'string' ? event.text : raw };
    },
    outcome(exitCode, protocolError) {
      const valid =
        result &&
        Number.isInteger(result.exit_code) &&
        typeof result.text === 'string' &&
        !protocolError &&
        !duplicate;
      const success = !!valid && exitCode === 0 && result?.exit_code === 0 && !result.error;
      return {
        success,
        report: typeof result?.text === 'string' ? clip(result.text) : undefined,
        sessionId: str(result?.session_id),
        error: success
          ? undefined
          : !valid || exitCode === undefined
            ? unverified
            : typeof result?.error === 'string' && result.error
              ? result.error.slice(0, 4096)
              : 'Hermes reported an unsuccessful result or process exit.',
      };
    },
  };
}

function claudeParser(): StreamParser {
  let result: JsonEvent | undefined;
  return {
    event(event, raw) {
      if (!event) return { log: raw };
      if (event.type === 'system' && event.subtype === 'init') return { session: str(event.session_id) };
      if (event.type === 'assistant') {
        const content = obj(event.message)?.content;
        const lines = (Array.isArray(content) ? content : [])
          .map((part) => {
            const item = obj(part);
            if (item?.type === 'text') return str(item.text);
            if (item?.type === 'tool_use') return `→ ${str(item.name) ?? 'tool'} ${brief(item.input)}`;
            return undefined;
          })
          .filter(Boolean);
        return { log: lines.join('\n') || undefined };
      }
      if (event.type === 'result') {
        result = event;
        return { session: str(event.session_id) };
      }
      return {};
    },
    outcome(exitCode, protocolError) {
      const denials = Array.isArray(result?.permission_denials) ? result.permission_denials : [];
      const report = str(result?.result);
      const success =
        !!result &&
        !protocolError &&
        exitCode === 0 &&
        result.is_error !== true &&
        result.subtype === 'success';
      const denied = [...new Set(denials.map((d) => str(obj(d)?.tool_name) ?? 'a tool'))];
      return {
        success,
        report: report === undefined ? undefined : clip(report),
        sessionId: str(result?.session_id),
        error: success
          ? undefined
          : !result || exitCode === undefined
            ? unverified
            : brief(report || `Claude Code ended with ${str(result.subtype) ?? 'an error'}.`, 4096),
        waiting: denied.length
          ? `Claude Code was not allowed to use ${denied.join(', ')}. Reply to approve a different approach, or run it yourself.`
          : undefined,
      };
    },
  };
}

function codexParser(): StreamParser {
  let message: string | undefined;
  let completed = false;
  let failure: string | undefined;
  return {
    event(event, raw) {
      if (!event) return { log: raw };
      const item = obj(event.item);
      const legacy = obj(event.msg);
      switch (event.type) {
        case 'thread.started':
          return { session: str(event.thread_id) };
        case 'item.started':
          return item?.type === 'command_execution' ? { log: `$ ${str(item.command) ?? ''}` } : {};
        case 'item.completed':
          if (item?.type === 'agent_message' || item?.type === 'assistant_message') {
            message = str(item.text) ?? message;
            return { log: message };
          }
          if (item?.type === 'command_execution')
            return {
              log: `${brief(item.aggregated_output, 2000)}${item.exit_code === undefined ? '' : `\n[exit ${item.exit_code}]`}`,
            };
          if (item?.type === 'file_change') return { log: `Edited ${brief(item.changes)}` };
          if (item?.type === 'error') return { log: str(item.message) };
          return {};
        case 'turn.completed':
          completed = true;
          return {};
        case 'turn.failed':
          failure = str(obj(event.error)?.message) ?? 'Codex turn failed.';
          return { log: failure };
        case 'error':
          failure = str(event.message) ?? 'Codex reported an error.';
          return { log: failure };
      }
      // Older codex releases wrap events in { msg: { type } }.
      if (legacy?.type === 'session_configured') return { session: str(legacy.session_id) };
      if (legacy?.type === 'agent_message') {
        message = str(legacy.message) ?? message;
        return { log: message };
      }
      if (legacy?.type === 'task_complete') {
        completed = true;
        message = str(legacy.last_agent_message) ?? message;
        return {};
      }
      if (legacy?.type === 'error') {
        failure = str(legacy.message) ?? 'Codex reported an error.';
        return { log: failure };
      }
      return {};
    },
    outcome(exitCode, protocolError) {
      const success = completed && !failure && !protocolError && exitCode === 0;
      return {
        success,
        report: message === undefined ? undefined : clip(message),
        error: success
          ? undefined
          : (failure?.slice(0, 4096) ??
            (exitCode === undefined || !completed ? unverified : 'Codex exited unsuccessfully.')),
      };
    },
  };
}

function opencodeParser(): StreamParser {
  let structured = false;
  let session: string | undefined;
  let step: string[] = [];
  let last: string[] = [];
  let plain: string[] = [];
  let failure: string | undefined;
  let permission: string | undefined;
  return {
    event(event, raw) {
      if (!event) {
        if (!structured) plain.push(raw);
        return { log: raw };
      }
      structured = true;
      const found = str(event.sessionID) ?? str(event.sessionId);
      const fresh = found && found !== session ? found : undefined;
      if (found) session = found;
      const part = obj(event.part);
      const type = str(event.type) ?? '';
      if (type === 'step_start') step = [];
      if (type === 'text') {
        const text = str(part?.text);
        if (text) step.push(text);
        return { session: fresh, log: text };
      }
      if (type === 'step_finish' && step.length) last = step;
      if (type === 'tool_use' || type === 'tool') {
        const state = obj(part?.state);
        return { session: fresh, log: `→ ${str(part?.tool) ?? 'tool'} ${str(state?.status) ?? ''}`.trim() };
      }
      if (type.includes('permission')) {
        permission = `OpenCode asked for permission: ${brief(event.permission ?? part ?? event, 200)}`;
        return { session: fresh, log: permission };
      }
      if (type === 'error') {
        const error = obj(event.error);
        failure =
          str(obj(error?.data)?.message) ?? str(error?.message) ?? str(error?.name) ?? 'OpenCode error.';
        return { session: fresh, log: failure };
      }
      return { session: fresh };
    },
    outcome(exitCode, protocolError) {
      const text = (structured ? (step.length ? step : last) : plain).join('\n').trim();
      const success = !failure && !protocolError && exitCode === 0;
      return {
        success,
        report: text ? clip(text) : undefined,
        sessionId: session,
        error: success
          ? undefined
          : (failure?.slice(0, 4096) ??
            (exitCode === undefined ? unverified : 'OpenCode exited unsuccessfully.')),
        waiting: permission,
      };
    },
  };
}

export function hermesArgs(
  agent: Pick<Agent, 'hermesPath' | 'profile' | 'workdir' | 'model' | 'provider'>,
  mode: 'version' | 'help' | 'run',
  resume?: string,
): string[] {
  const args: string[] = [];
  if (agent.profile) args.push('-p', agent.profile);
  if (mode === 'version') args.push('--version');
  else {
    args.push('chat');
    if (mode === 'help') args.push('--help');
    else {
      if (agent.workdir) args.push('--in', agent.workdir);
      if (agent.model) args.push('--model', agent.model);
      if (agent.provider) args.push('--provider', agent.provider);
      if (resume) args.push('--resume', resume);
      args.push('--oneshot', '--query-file', '-', '--format', 'stream-json');
    }
  }
  return args;
}

const toolPath = (agent: Agent, tool: CodingTool) => {
  const path = agent.toolPaths?.[tool] || agent.tools?.[tool]?.path;
  if (!path) throw new Error(`${tool} was not found on this agent. Run a connection check.`);
  return path;
};
const toolDir = (agent: Agent, path: string) =>
  agent.transport !== 'local' && path.startsWith('/') ? posix.dirname(path) : undefined;

export const runners: Record<Runner, RunnerSpec> = {
  hermes: {
    canResume: (agent) => !!agent.resume,
    parser: hermesParser,
    build(agent, context) {
      const resolved = {
        ...agent,
        workdir: context.workdir,
        model: context.model,
        provider: context.provider,
      };
      return {
        argv: [agent.hermesPath || 'hermes', ...hermesArgs(resolved, 'run', context.resume)],
        stdin: context.prompt,
        cwd: agent.transport === 'local' ? context.workdir || undefined : undefined,
      };
    },
  },
  claude: {
    canResume: () => true,
    parser: claudeParser,
    build(agent, context) {
      const path = toolPath(agent, 'claude');
      const argv = [
        path,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
      ];
      if (context.model) argv.push('--model', context.model);
      if (context.resume) argv.push('--resume', context.resume);
      return {
        argv,
        stdin: context.prompt,
        cwd: context.workdir || undefined,
        pathDir: toolDir(agent, path),
      };
    },
  },
  codex: {
    canResume: () => true,
    parser: codexParser,
    build(agent, context) {
      const path = toolPath(agent, 'codex');
      const argv = [path, 'exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
      if (context.model) argv.push('-m', context.model);
      if (context.resume) argv.push('resume', context.resume);
      argv.push('-');
      return {
        argv,
        stdin: context.prompt,
        cwd: context.workdir || undefined,
        pathDir: toolDir(agent, path),
      };
    },
  },
  opencode: {
    canResume: () => true,
    parser: opencodeParser,
    build(agent, context) {
      const path = toolPath(agent, 'opencode');
      const argv = [path, 'run', '--format', 'json'];
      if (context.model) argv.push('-m', context.model);
      if (context.resume) argv.push('--session', context.resume);
      // opencode run takes the message as an argument; stdin stays empty.
      argv.push('--', context.prompt);
      return { argv, stdin: '', cwd: context.workdir || undefined, pathDir: toolDir(agent, path) };
    },
  },
};

/**
 * POSIX script that prints "tool<TAB>path<TAB>version" for each coding CLI.
 * Non-login SSH shells often miss npm, nvm, bun, and ~/.local paths, so common locations are searched too.
 */
export function toolDetectionScript(quote: (value: string) => string, overrides: Agent['toolPaths'] = {}) {
  const dirs =
    '"$HOME/.local/bin" "$HOME/.claude/local" "$HOME/.opencode/bin" "$HOME/.npm-global/bin" "$HOME/.bun/bin" "$HOME/.volta/bin" "$HOME/bin" /usr/local/bin /opt/homebrew/bin "$HOME"/.nvm/versions/node/*/bin';
  const timer = 't=""; command -v timeout >/dev/null 2>&1 && t="timeout 4"';
  const checks = (['claude', 'codex', 'opencode'] as const).map((tool) => {
    const find = overrides[tool]
      ? `p=${quote(overrides[tool]!)}`
      : `p=$(command -v ${tool} 2>/dev/null); if [ -z "$p" ]; then for d in ${dirs}; do if [ -x "$d/${tool}" ]; then p="$d/${tool}"; break; fi; done; fi`;
    return `${find}; v=""; if [ -n "$p" ] && [ -x "$p" ]; then v=$(PATH="$(dirname "$p"):$PATH" $t "$p" --version 2>/dev/null </dev/null | head -n 1); fi; printf '%s\\t%s\\t%s\\n' ${tool} "$p" "$v"`;
  });
  return [timer, ...checks, 'true'].join('; ');
}

export function parseToolDetection(output: string): Agent['tools'] {
  const tools: NonNullable<Agent['tools']> = {};
  for (const line of output.split('\n')) {
    const [tool, path, version] = line.replace(/\r$/, '').split('\t');
    if (
      (tool === 'claude' || tool === 'codex' || tool === 'opencode') &&
      path?.startsWith('/') &&
      version?.trim()
    )
      tools[tool] = { path: path.slice(0, 1024), version: version.trim().slice(0, 200) };
  }
  return tools;
}
