import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import ssh2, { type Connection } from 'ssh2';

test('real workspace: vault, encrypted agent settings, task edits, board, reports, persistence and lock', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByText('Local connection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up vault', exact: true }).click();
  await page.getByLabel('Vault passphrase', { exact: true }).fill('a long test passphrase only');
  await page.getByLabel('Confirm passphrase').fill('a long test passphrase only');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add agent', exact: true }).first().click();
  await page.getByLabel('Agent name').fill('Test Atlas');
  await page.getByLabel('Host / IP address').fill('127.0.0.1');
  await page.getByLabel('SSH username').fill('test-user');
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await page.getByLabel('SSH password').fill('not-a-real-ssh-password');
  await page.getByRole('button', { name: 'Save agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test Atlas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Configure Test Atlas' }).click();
  await expect(page.getByLabel('SSH password')).toHaveValue('');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /^Task board/ }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Verify the local workspace');
  await page.getByLabel('Instructions').fill('Review this task without executing it.');
  await page.getByLabel('Assign to').selectOption({ label: 'Test Atlas (127.0.0.1)' });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Verify the local workspace', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('ready');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Ready column', exact: true })
      .getByRole('button', { name: 'Open task: Verify the local workspace' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Open task: Verify the local workspace' })
    .dragTo(page.getByRole('region', { name: 'In progress column', exact: true }));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('ready');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open task: Verify the local workspace' })).toBeVisible();
  await page.getByLabel('Search tasks').fill('does not exist');
  await expect(page.getByRole('button', { name: 'Open task: Verify the local workspace' })).toHaveCount(0);
  await page.getByLabel('Clear search').click();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('button', { name: /Verify the local workspace/ })).toBeVisible();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('Less guessing. More knowing.')).toBeVisible();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your shell, right here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('workspace pages and dialogs have no detected WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo' }).click();
  const violations: unknown[] = [];
  const audit = async () => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    violations.push(
      ...result.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
    );
  };
  await audit();
  await page.getByRole('button', { name: 'Open task: Research local inference options' }).click();
  await audit();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const name of ['Agents', 'Reports', 'Terminal']) {
    await page.getByRole('button', { name, exact: true }).click();
    if (name === 'Terminal')
      await expect(
        page.getByRole('heading', { name: 'A direct line to your agents', exact: true }),
      ).toBeVisible();
    await audit();
  }
  expect(violations).toEqual([]);
});

test('sample workspace is read-only and usable on desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo' }).click();
  await expect(page.getByText('Sample workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open task:/ })).toHaveCount(9);
  await page.screenshot({ path: 'test-results/desktop-board.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open task: Research local inference options' }).click();
  await expect(page.getByRole('button', { name: 'Run task', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toBeDisabled();
  await expect(page.getByText('Agent completion report', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-board.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent connections' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock to connect' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/mobile-terminal.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('verified SSH connection runs a task, streams its report, and supports an interactive terminal', async ({
  page,
}) => {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
  const parsedKey = ssh2.utils.parseKey(hostKey);
  if (parsedKey instanceof Error || Array.isArray(parsedKey)) throw new Error('Test host key invalid');
  const expectedFingerprint = `SHA256:${createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
  const connections = new Set<Connection>();
  const errors: string[] = [];
  let authAttempts = 0;
  let prompt = '';
  let shellInput = '';
  let shellClosed = false;
  const ssh = new ssh2.Server({ hostKeys: [hostKey] }, (connection) => {
    connections.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => connections.delete(connection));
    connection.on('authentication', (context) => {
      authAttempts++;
      if (
        context.method === 'password' &&
        context.username === 'fixture' &&
        context.password === 'browser-test-only'
      )
        context.accept();
      else context.reject(['password']);
    });
    connection.on('ready', () =>
      connection.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept?.());
        session.on('window-change', (accept) => accept?.());
        session.on('shell', (accept) => {
          const stream = accept();
          stream.on('error', () => {});
          stream.on('close', () => {
            shellClosed = true;
          });
          stream.write('SSH fixture ready\r\n$ ');
          stream.on('data', (chunk: Buffer) => {
            shellInput += chunk.toString();
            stream.write(chunk);
          });
        });
        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          stream.on('error', () => {});
          if (info.command.endsWith("'--version'")) {
            stream.write('Hermes browser fixture\n');
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command.endsWith("'--help'")) {
            stream.write('--oneshot --query-file --format stream-json\n');
            stream.exit(0);
            stream.end();
            return;
          }
          stream.on('data', (chunk: Buffer) => {
            prompt += chunk.toString();
          });
          stream.on('end', () => {
            stream.write('{"type":"system","subtype":"init","session_id":"browser-session"}\n');
            stream.write('{"type":"text","text":"Inspecting the example workspace."}\n');
            setTimeout(() => {
              if (stream.destroyed) return;
              stream.write(
                '{"type":"result","text":"Verified the example workspace. Ready for human review.","session_id":"browser-session","exit_code":0}\n',
              );
              stream.exit(0);
              stream.end();
            }, 800);
          });
        });
      }),
    );
  });
  ssh.listen(0, '127.0.0.1');
  await once(ssh, 'listening');
  const address = ssh.address();
  if (!address || typeof address === 'string') throw new Error('No test SSH port');
  try {
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/');
    await expect(page.getByText('Local connection', { exact: true })).toBeVisible();
    const vaultButton = page.getByRole('button', { name: /^(Set up|Unlock) vault$/ });
    if (await vaultButton.isVisible()) {
      await vaultButton.click();
      await page.getByLabel('Vault passphrase', { exact: true }).fill('a long test passphrase only');
      if (await page.getByLabel('Confirm passphrase').isVisible())
        await page.getByLabel('Confirm passphrase').fill('a long test passphrase only');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^(Create|Unlock) vault$/ })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Add agent', exact: true }).first().click();
    await page.getByLabel('Agent name').fill('SSH Fixture');
    await page.getByLabel('Host / IP address').fill('127.0.0.1');
    await page.getByLabel('SSH port').fill(String(address.port));
    await page.getByLabel('SSH username').fill('fixture');
    await page.getByRole('button', { name: 'Password', exact: true }).click();
    await page.getByLabel('SSH password').fill('browser-test-only');
    await page.getByRole('button', { name: 'Save agent', exact: true }).click();
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'SSH Fixture', exact: true }) });
    await card.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.getByRole('heading', { name: 'Verify this host', exact: true })).toBeVisible();
    await expect(page.getByText(expectedFingerprint, { exact: true })).toBeVisible();
    expect(authAttempts).toBe(0);
    await page.getByRole('checkbox', { name: 'I independently verified this fingerprint.' }).check();
    await page.getByRole('button', { name: 'Trust host & check' }).click();
    await expect(
      page.getByText('SSH Fixture is reachable and ready for tasks.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Task board/ }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Task title').fill('Browser SSH task');
    await page.getByLabel('Instructions').fill('Inspect the example workspace without changing files.');
    await page
      .getByRole('combobox', { name: 'Assign to' })
      .selectOption({ label: 'SSH Fixture (127.0.0.1)' });
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Browser SSH task', exact: true }),
    ).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Run task', exact: true }).click();
    await expect(page.getByLabel('Task execution log')).toContainText('Inspecting the example workspace.');
    await expect(page.getByRole('dialog').locator('.status-pill')).toHaveText('Review');
    expect(prompt).toBe('Inspect the example workspace without changing files.');
    await page.getByRole('tab', { name: 'Report', exact: true }).click();
    await expect(page.locator('.report-text')).toHaveText(
      'Verified the example workspace. Ready for human review.',
    );
    await page.getByRole('button', { name: 'Mark done', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.status-pill')).toHaveText('Done');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByLabel('Terminal agent').selectOption({ label: 'SSH Fixture / 127.0.0.1' });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.locator('.xterm-screen').click();
    await page.keyboard.type('echo hello\r');
    await expect.poll(() => shellInput).toContain('echo hello\r');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect.poll(() => shellClosed).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    for (const connection of connections) connection.end();
    await new Promise<void>((resolve) => ssh.close(() => resolve()));
  }
});
