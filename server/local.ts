import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Agent, CodingTool } from '../shared/types.ts';
import { ApiError } from './vault.ts';

export function discoverLocalHermes(): string | undefined {
  const paths =
    process.platform === 'win32'
      ? [
          join(
            process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
            'hermes',
            'hermes-agent',
            '.hermes',
            'bin',
            'hermes.exe',
          ),
        ]
      : [join(homedir(), '.local', 'bin', 'hermes'), join(homedir(), 'hermes', '.venv', 'bin', 'hermes')];
  return paths.find(existsSync);
}

/** Finds a coding CLI executable on PATH or in common install folders. Batch shims are not launchable. */
export function discoverLocalTool(tool: CodingTool): string | undefined {
  const name = process.platform === 'win32' ? `${tool}.exe` : tool;
  const folders = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
    join(homedir(), '.opencode', 'bin'),
    join(homedir(), '.bun', 'bin'),
    ...(process.platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin']),
  ];
  for (const folder of folders) {
    if (!folder || !isAbsolute(folder)) continue;
    const candidate = join(folder, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* Not here. */
    }
  }
  return undefined;
}

export function spawnProgram(executable: string, args: string[], cwd?: string, pathDir?: string) {
  if (!isAbsolute(executable)) throw new ApiError(400, 'Local agents require an absolute executable path.');
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const binary = executable.replace(/\.(cmd|bat)$/i, '.exe');
    if (!existsSync(binary))
      throw new ApiError(400, 'Select an .exe launcher. Batch files are not supported.');
    return spawnProgram(binary, args, cwd, pathDir);
  }
  const extra = pathDir ?? dirname(executable);
  return spawn(executable, args, {
    shell: false,
    windowsHide: true,
    cwd: cwd || homedir(),
    env: {
      ...process.env,
      PATH: `${extra}${delimiter}${process.env.PATH ?? ''}`,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function spawnLocal(agent: Pick<Agent, 'hermesPath' | 'workdir'>, args: string[]) {
  return spawnProgram(agent.hermesPath, args, agent.workdir);
}

export function captureLocal(agent: Agent, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ApiError(502, 'Local Hermes check interrupted.'));
      return;
    }
    const child = spawnLocal(agent, args);
    const stdout = new StringDecoder('utf8');
    const stderr = new StringDecoder('utf8');
    let output = '';
    let settled = false;
    const finish = (error?: ApiError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (child.exitCode === null) child.kill();
      if (error) reject(error);
      else resolve(output + stdout.end() + stderr.end());
    };
    const abort = () => finish(new ApiError(502, 'Local Hermes check interrupted.'));
    const timer = setTimeout(() => finish(new ApiError(504, 'Local Hermes check timed out.')), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    const data = (chunk: Buffer, decoder: StringDecoder) => {
      if (settled) return;
      output += decoder.write(chunk);
      if (output.length > 65536) finish(new ApiError(502, 'Local Hermes check output exceeded its limit.'));
    };
    child.stdout.on('data', (chunk: Buffer) => data(chunk, stdout));
    child.stderr.on('data', (chunk: Buffer) => data(chunk, stderr));
    child.once('error', (error: NodeJS.ErrnoException) =>
      finish(
        new ApiError(
          502,
          `Could not launch local Hermes (${error.code ?? 'unknown error'}). Check the executable, working directory, and manager process permissions.`,
        ),
      ),
    );
    child.once('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new ApiError(
              502,
              `Local Hermes exited with code ${code ?? 'unknown'}. Check its installation and the manager process permissions.`,
            ),
      ),
    );
    child.stdin.on('error', () => {});
    child.stdin.end();
  });
}
