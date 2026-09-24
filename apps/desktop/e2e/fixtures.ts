import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const appDir = path.resolve(__dirname, '..');

interface AppFixtures {
  electronApp: ElectronApplication;
  window: Page;
}

/**
 * Launches the built app in demo mode with a throwaway config directory, so e2e runs never
 * touch the developer's real `~/.raml-kql/` or reach the network.
 */
export const test = base.extend<AppFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern.
  electronApp: async ({}, use) => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'raml-kql-e2e-'));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    const app = await electron.launch({
      args: [appDir, '--demo'],
      env: { ...env, RAML_KQL_CONFIG_DIR: configDir, NODE_ENV: 'production' },
    });
    try {
      await use(app);
    } finally {
      await app.close();
      rmSync(configDir, { recursive: true, force: true });
    }
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
