import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the *built* app (`out/`) in demo mode through Playwright's
 * Electron support. `pnpm test:e2e` builds first. Electron apps hold a single-instance lock,
 * so tests run one at a time.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
