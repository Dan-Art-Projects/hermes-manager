import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { Vault, ApiError } from '../server/vault.ts';
import { workspace, nextOccurrence, normalizeModels } from '../server/workspace.ts';
import type { Schedule } from '../shared/types.ts';

test('catalog free filter requires explicit zero prices and excludes subscription and unknown pricing', () => {
  const models = normalizeModels([
    { id: 'free', pricing: { prompt: '0', completion: 0 } },
    { id: 'paid', pricing: { prompt: '0.000001', completion: '0.000002' } },
    { id: 'unknown' },
    { id: 'subscription', pricing: { prompt: 0, completion: 0, billing_mode: 'subscription' } },
    { id: 'invalid', pricing: { prompt: -1, completion: 'garbage' } },
  ]);
  assert.deepEqual(
    models.filter((m) => m.free).map((m) => m.id),
    ['free'],
  );
  assert.equal(models[1].input, 1);
  assert.equal(models[1].output, 2);
  assert.equal(models[2].input, null);
  assert.equal(
    nextOccurrence('2026-01-01T00:00:00Z', 60, Date.parse('2026-01-01T03:30:00Z')),
    '2026-01-01T04:00:00.000Z',
  );
});

test('scheduler waits for vault and busy agents, coalesces missed runs, and disables one-shot schedules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-schedules-')),
    store = new Store(dir),
    vault = new Vault(store);
  let count = 0,
    busy = false;
  const service = workspace(
    express(),
    store,
    vault,
    dir,
    (task) => {
      if (busy) throw new ApiError(409, 'Agent busy');
      count++;
      return task;
    },
    () => {},
  );
  const item: Schedule = {
    id: 'schedule',
    title: 'Report',
    description: 'Report',
    agentId: 'agent',
    nextRun: '2020-01-01T00:00:00Z',
    intervalMinutes: 60,
    enabled: true,
  };
  try {
    store.setSetting('schedules', [item]);
    service.tick();
    assert.equal(count, 0);
    await vault.unlock('test schedule passphrase');
    busy = true;
    service.tick();
    assert.equal(count, 0);
    assert.equal(store.setting<Schedule[]>('schedules', [])[0].nextRun, item.nextRun);
    busy = false;
    service.tick();
    assert.equal(count, 1);
    assert.ok(Date.parse(store.setting<Schedule[]>('schedules', [])[0].nextRun) > Date.now());
    service.tick();
    assert.equal(count, 1);
    store.setSetting('schedules', [{ ...item, intervalMinutes: 0 }]);
    service.tick();
    service.tick();
    assert.equal(count, 2);
    assert.equal(store.setting<Schedule[]>('schedules', [])[0].enabled, false);
  } finally {
    service.close();
    vault.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
