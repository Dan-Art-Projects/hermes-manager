import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4311', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:4311/api/health',
    env: { PORT: '4311', HERMES_MANAGER_DATA_DIR: join(tmpdir(), 'opencode', `hermes-ui-${process.pid}`) },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
