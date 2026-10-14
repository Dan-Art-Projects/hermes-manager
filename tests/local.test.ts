import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLocal } from '../server/local.ts';
import type { Agent } from '../shared/types.ts';

const agent: Agent = {
  id: 'local-test',
  name: 'Local',
  transport: 'local',
  host: 'localhost',
  port: 22,
  username: 'local',
  authType: 'privateKey',
  hermesPath: process.execPath,
  workdir: process.cwd(),
  profile: '',
  status: 'unknown',
  hasCredential: false,
  createdAt: new Date().toISOString(),
};

test('local execution preserves shell metacharacters as literal arguments', async () => {
  const literal = 'quotes " & echo injected | %PATH% $(echo injected)';
  const output = await captureLocal(
    agent,
    ['-e', 'console.log(process.argv[1])', literal],
    new AbortController().signal,
  );
  assert.equal(output.trim(), literal);
});

test('local checks report exit codes and reject missing working directories', async () => {
  await assert.rejects(
    captureLocal(agent, ['-e', 'process.exit(7)'], new AbortController().signal),
    /exited with code 7/,
  );
  await assert.rejects(
    captureLocal(
      { ...agent, workdir: `${process.cwd()}/missing-directory-for-local-test` },
      ['--version'],
      new AbortController().signal,
    ),
    /ENOENT/,
  );
});

test('aborting a local check rejects instead of reporting success', async () => {
  const controller = new AbortController();
  const result = captureLocal(agent, ['-e', 'setTimeout(() => {}, 30000)'], controller.signal);
  controller.abort();
  await assert.rejects(result, /interrupted/);
});
