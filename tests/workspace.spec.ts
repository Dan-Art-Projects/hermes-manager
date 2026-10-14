import { test, expect } from '@playwright/test';

test('schedules, documents, gallery and Nous model selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const state = await (await page.request.get('/api/state')).json();
  const headers = { 'X-Manager-Token': state.csrfToken, Origin: 'http://127.0.0.1:4311' };
  if (!state.vault.unlocked)
    await page.request.post('/api/vault/unlock', {
      headers,
      data: { passphrase: 'a long test passphrase only' },
    });
  const agentResponse = await page.request.post('/api/agents', {
    headers,
    data: {
      transport: 'local',
      name: 'Scheduled agent',
      host: 'localhost',
      port: 22,
      username: 'local',
      authType: 'password',
      hermesPath: process.execPath,
      workdir: '',
      profile: '',
    },
  });
  expect(agentResponse.ok()).toBeTruthy();
  const agent = await agentResponse.json();
  await page.reload();
  await page.getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Daily report');
  await page.getByLabel('Instructions', { exact: true }).fill('Write a report to artifacts/report.md');
  await page.getByLabel('Agent', { exact: true }).selectOption(agent.id);
  await page.getByLabel('Next run').fill('2099-01-01T09:00');
  await page.getByRole('button', { name: 'Create schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daily report', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page
    .getByLabel('Upload file')
    .setInputFiles({ name: 'report.md', mimeType: 'text/plain', buffer: Buffer.from('# Agent report') });
  await expect(page.getByRole('heading', { name: 'report.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Media gallery', exact: true }).click();
  await expect(page.getByText('No media files yet.')).toBeVisible();
  await page.route('**/api/nous', (route) => route.fulfill({ json: { configured: true } }));
  await page.route('**/api/nous/models*', (route) =>
    route.fulfill({
      json: {
        models: [
          { id: 'test-free', name: 'Free test model', input: 0, output: 0, free: true },
          { id: 'test-paid', name: 'Paid test model', input: 1, output: 2, free: false },
        ],
        fetchedAt: new Date().toISOString(),
      },
    }),
  );
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh models' }).click();
  await page.getByLabel('Free only').check();
  await expect(page.getByRole('heading', { name: 'Paid test model' })).toHaveCount(0);
  await page.getByLabel('Specific agents').check();
  await page.getByRole('checkbox', { name: 'Scheduled agent' }).check();
  await page.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Selected test-free' })).toBeVisible();
  const saved = await (await page.request.get('/api/state')).json();
  expect(saved.agents.find((a: { id: string }) => a.id === agent.id).model).toBe('test-free');
  await page.screenshot({ path: '.tmp/workspace-models.png', fullPage: true });
  await page.getByLabel('Global default').check();
  await page.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Global model set to test-free' })).toBeVisible();
  expect((await (await page.request.get('/api/state')).json()).defaults.model).toBe('test-free');
  await page.getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.screenshot({ path: '.tmp/workspace-schedules.png', fullPage: true });

  // A task waiting on the human shows in the inbox, the board column, and the tab title.
  const task = await (
    await page.request.post('/api/tasks', {
      headers,
      data: { title: 'Pick a schema', agentId: agent.id, status: 'waiting' },
    })
  ).json();
  await page.getByRole('button', { name: /^Task board/ }).click();
  const inbox = page.getByRole('region', { name: 'Needs you', exact: true });
  await expect(inbox.getByText('Pick a schema')).toBeVisible();
  await expect(page).toHaveTitle(/^\(\d+\) Hermes Manager/);
  await expect(
    page.getByRole('region', { name: 'Needs you column' }).getByText('Pick a schema'),
  ).toBeVisible();
  await inbox.getByRole('button', { name: /Pick a schema/ }).click();
  await expect(page.getByText('is waiting on you.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Task marked done.' })).toBeVisible();
  expect(
    (await (await page.request.get('/api/state')).json()).tasks.find((t: { id: string }) => t.id === task.id)
      .status,
  ).toBe('done');
  await page.keyboard.press('Escape');

  // Colours: the agent got a palette colour, and editing it keeps the connection state.
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Scheduled agent' }).click();
  await page.getByRole('radio', { name: /^violet/ }).check({ force: true });
  await page.getByRole('button', { name: 'Save agent' }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/state')).json()).agents.find(
          (a: { id: string }) => a.id === agent.id,
        ).color,
    )
    .toBe('violet');
});
