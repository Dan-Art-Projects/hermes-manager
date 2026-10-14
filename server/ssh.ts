import { createHash } from 'node:crypto';
import { spawnProgram } from './local.ts';
import { StringDecoder } from 'node:string_decoder';
import ssh2, { type Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { Agent, TaskLog } from '../shared/types.ts';
import { ApiError, type Credentials } from './vault.ts';
import { hermesArgs, type Invocation, type ParsedOutcome, type StreamParser } from './runners.ts';

export { hermesArgs };

export function quote(value: string): string {
  if (value.includes('\0')) throw new ApiError(400, 'Command arguments cannot contain NUL bytes.');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function hermesCommand(
  agent: Pick<Agent, 'hermesPath' | 'profile' | 'workdir' | 'model' | 'provider'>,
  mode: 'version' | 'help' | 'run',
  resume?: string,
): string {
  return [agent.hermesPath || 'hermes', ...hermesArgs(agent, mode, resume)].map(quote).join(' ');
}

/** Keeps a leading ~/ unquoted so the remote shell expands it. */
function directory(path: string): string {
  if (path === '~') return '~';
  if (path.startsWith('~/')) return `~/${quote(path.slice(2))}`;
  return quote(path);
}

export function shellCommand(invocation: Invocation): string {
  const parts: string[] = [];
  if (invocation.cwd) parts.push(`cd ${directory(invocation.cwd)} &&`);
  if (invocation.pathDir) parts.push(`PATH=${quote(invocation.pathDir)}:"$PATH"`);
  parts.push(invocation.argv.map(quote).join(' '));
  return parts.join(' ');
}

export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

export function connectSSH(
  agent: Agent,
  credentials: Credentials,
  observed: (value: string) => void,
  signal: AbortSignal,
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let untrusted: string | undefined;
    let ready = false;
    let settled = false;
    const finish = (error?: ApiError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        client.destroy();
        reject(error);
      } else {
        ready = true;
        resolve(client);
      }
    };
    // Operation cleanup must abort without calling end() first: ssh2.destroy() requires a writable socket.
    const abort = () => {
      finish(new ApiError(502, 'SSH connection ended; remote outcome may be unknown.', 'SSH_INTERRUPTED'));
      client.destroy();
    };
    const timer = setTimeout(
      () => finish(new ApiError(504, 'SSH connection timed out.', 'SSH_TIMEOUT')),
      15_000,
    );
    client.on('error', (error: Error & { level?: string }) => {
      if (ready) return;
      finish(
        untrusted
          ? new ApiError(
              409,
              'SSH host key is not trusted. Verify the fingerprint independently before trusting it.',
              'HOST_KEY_UNTRUSTED',
              untrusted,
            )
          : new ApiError(
              502,
              error.level === 'client-authentication'
                ? 'SSH authentication failed. Check the saved credentials.'
                : 'SSH connection failed.',
              'SSH_FAILED',
            ),
      );
    });
    client.once('close', () => {
      signal.removeEventListener('abort', abort);
      finish(new ApiError(502, 'SSH connection closed before authentication completed.', 'SSH_CLOSED'));
    });
    client.once('ready', () => finish());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      client.connect({
        host: agent.host,
        port: agent.port,
        username: agent.username,
        ...(agent.authType === 'password'
          ? { password: credentials.password }
          : { privateKey: credentials.privateKey, passphrase: credentials.passphrase }),
        tryKeyboard: false,
        agent: undefined,
        readyTimeout: 12_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) => {
          const value = fingerprint(key);
          if (value === agent.fingerprint) return true;
          untrusted = value;
          observed(value);
          return false;
        },
      });
    } catch {
      finish(new ApiError(400, 'SSH configuration or private key is invalid.', 'SSH_CONFIG_INVALID'));
    }
  });
}

export function execCapture(client: Client, command: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let output = '';
    let settled = false;
    let exitCode: number | undefined;
    const finish = (error?: ApiError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      client?.off('close', disconnected);
      client?.off('error', disconnected);
      channel?.close();
      if (error) reject(error);
      else resolve(output);
    };
    const abort = () => finish(new ApiError(502, 'SSH check interrupted.', 'SSH_INTERRUPTED'));
    const disconnected = () => finish(new ApiError(502, 'SSH connection lost during check.', 'SSH_CLOSED'));
    const timer = setTimeout(
      () => finish(new ApiError(504, 'Hermes check timed out.', 'PROBE_TIMEOUT')),
      15_000,
    );
    client.once('close', disconnected);
    client.once('error', disconnected);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    client.exec(command, { pty: false }, (error, stream) => {
      if (settled) {
        stream?.close();
        return;
      }
      if (error) {
        finish(new ApiError(502, 'Could not execute Hermes on the SSH host.', 'HERMES_UNAVAILABLE'));
        return;
      }
      channel = stream;
      const decoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      const data = (chunk: Buffer, decoder: StringDecoder) => {
        output += decoder.write(chunk);
        if (output.length > 65536)
          finish(new ApiError(502, 'Hermes check output exceeded its limit.', 'PROBE_OUTPUT_LIMIT'));
      };
      stream.on('data', (chunk: Buffer) => data(chunk, decoder));
      stream.stderr.on('data', (chunk: Buffer) => data(chunk, stderrDecoder));
      stream.once('exit', (code) => {
        exitCode = typeof code === 'number' ? code : undefined;
      });
      stream.once('error', () => finish(new ApiError(502, 'Hermes check channel failed.', 'SSH_FAILED')));
      stream.once('close', () => {
        output += decoder.end() + stderrDecoder.end();
        finish(
          exitCode === 0
            ? undefined
            : new ApiError(
                502,
                'Hermes command failed. Check its path and installation.',
                'HERMES_UNAVAILABLE',
              ),
        );
      });
      stream.end();
    });
  });
}

export type JsonEvent = Record<string, unknown>;

// Oversized lines are discarded through their next newline, never accumulated unboundedly.
export class JsonLines {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private dropping = false;
  constructor(
    private line: (event: JsonEvent | undefined, raw: string) => void,
    private overflow: () => void,
    private limit = 256 * 1024,
  ) {}

  write(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }

  private consume(text: string): void {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      const end = newline === -1 ? text.length : newline;
      const part = text.slice(start, end);
      if (!this.dropping) {
        if (this.pending.length + part.length > this.limit) {
          this.pending = '';
          this.dropping = true;
          this.overflow();
        } else this.pending += part;
      }
      if (newline !== -1) {
        if (!this.dropping) this.emit();
        this.pending = '';
        this.dropping = false;
      }
      start = newline === -1 ? text.length : newline + 1;
    }
  }

  private emit(): void {
    const raw = this.pending.replace(/\r$/, '');
    if (!raw) return;
    let event: JsonEvent | undefined;
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) event = value as JsonEvent;
    } catch {
      /* Non-JSON diagnostics are still useful logs. */
    }
    this.line(event, raw);
  }

  end(): void {
    this.consume(this.decoder.end());
    if (!this.dropping) this.emit();
    this.pending = '';
  }
}

export interface RunOutcome extends ParsedOutcome {
  exitCode?: number;
}

export function runAgent(
  client: Client | undefined,
  agent: Agent,
  invocation: Invocation,
  parser: StreamParser,
  signal: AbortSignal,
  log: (stream: TaskLog['stream'], text: string) => void,
  session: (id: string) => void,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let channel: ClientChannel | undefined;
    let settled = false;
    let exitCode: number | undefined;
    let localCleanup: (() => void) | undefined;
    let sessionId: string | undefined;
    let protocolError = false;
    const stderr = new StringDecoder('utf8');
    const lines = new JsonLines(
      (event, raw) => {
        if (settled) return;
        const parsed = parser.event(event, raw);
        if (parsed.session && parsed.session.slice(0, 512) !== sessionId) {
          sessionId = parsed.session.slice(0, 512);
          session(sessionId);
        }
        if (parsed.log) log('stdout', parsed.log);
      },
      () => {
        protocolError = true;
        log('system', 'An oversized stream event was discarded; completion cannot be verified.');
      },
    );
    const finish = (error?: string) => {
      if (settled) return;
      lines.end();
      const tail = stderr.end();
      if (tail) log('stderr', tail);
      settled = true;
      signal.removeEventListener('abort', abort);
      client?.off('error', disconnected);
      client?.off('close', disconnected);
      channel?.close();
      localCleanup?.();
      const outcome = parser.outcome(exitCode, protocolError);
      const id = outcome.sessionId?.slice(0, 512) ?? sessionId;
      resolve(
        error
          ? { success: false, report: outcome.report, sessionId: id, exitCode, error }
          : { ...outcome, sessionId: id, exitCode },
      );
    };
    const abort = () =>
      finish(
        'Task connection ended or its deadline expired. Remote outcome is unknown; it was not confirmed cancelled. Inspect the host before retrying.',
      );
    const disconnected = () =>
      finish('SSH connection lost. Remote outcome is unknown; inspect the host before retrying.');
    signal.addEventListener('abort', abort, { once: true });
    client?.once('close', disconnected);
    client?.once('error', disconnected);
    if (signal.aborted) {
      abort();
      return;
    }
    const [program, ...args] = invocation.argv;
    if (agent.transport === 'local') {
      try {
        const child = spawnProgram(program, args, invocation.cwd || agent.workdir, invocation.pathDir);
        localCleanup = () => {
          if (child.exitCode === null) child.kill();
        };
        child.stdout.on('data', (chunk: Buffer) => {
          if (!settled) lines.write(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (!settled) log('stderr', stderr.write(chunk));
        });
        child.once('error', () => finish('Could not launch the local agent. Check the executable path.'));
        child.stdin.on('error', () => {
          /* Early exit is handled by close/result verification. */
        });
        child.once('close', (code) => {
          exitCode = code ?? undefined;
          finish();
        });
        child.stdin.end(invocation.stdin);
      } catch (error) {
        finish(
          error instanceof ApiError
            ? error.message
            : 'Could not launch the local agent. Check the executable path and installation.',
        );
      }
      return;
    }
    if (!client) {
      finish('SSH connection is missing.');
      return;
    }
    client.exec(shellCommand(invocation), { pty: false }, (error, stream) => {
      if (settled) {
        stream?.close();
        return;
      }
      if (error) {
        finish('SSH could not open the task command.');
        return;
      }
      channel = stream;
      stream.on('data', (chunk: Buffer) => {
        if (!settled) lines.write(chunk);
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        if (!settled) log('stderr', stderr.write(chunk));
      });
      stream.once('exit', (code) => {
        exitCode = typeof code === 'number' ? code : undefined;
      });
      stream.once('error', disconnected);
      stream.once('close', () => finish());
      stream.end(invocation.stdin);
    });
  });
}

export interface RemoteFile {
  name: string;
  size: number;
  mtime: number;
}

export function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SFTP timed out.')), 10_000);
    try {
      client.sftp((error, sftp) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(sftp);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** SFTP paths are relative to the login directory; a leading ~/ means the same thing. */
export const sftpPath = (path: string) => (path === '~' ? '.' : path.replace(/^~\//, '')) || '.';

/** Regular files only. Symlinks, directories, and unreadable folders are skipped. */
export function listRemote(sftp: SFTPWrapper, dir: string): Promise<RemoteFile[]> {
  return new Promise((resolve) => {
    sftp.readdir(sftpPath(dir), (error, list) => {
      if (error || !Array.isArray(list)) {
        resolve([]);
        return;
      }
      resolve(
        list
          .filter((entry) => (entry.attrs.mode & 0o170000) === 0o100000 && !entry.filename.includes('/'))
          .slice(0, 500)
          .map((entry) => ({ name: entry.filename, size: entry.attrs.size, mtime: entry.attrs.mtime })),
      );
    });
  });
}

export function readRemote(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(sftpPath(path), (error, data) => (error ? reject(error) : resolve(data)));
  });
}
