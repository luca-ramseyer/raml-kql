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
  /** A throwaway config dir, so e2e runs never touch the real `~/.raml-kql/`. */
  configDir: string;
  /** Launch the built app in demo mode (call again after `close()` to test restarts). */
  launch: () => Promise<{ app: ElectronApplication; window: Page }>;
  electronApp: ElectronApplication;
  window: Page;
}

export const test = base.extend<AppFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern.
  configDir: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raml-kql-e2e-'));
    try {
      await use(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  launch: async ({ configDir }, use) => {
    const launched: ElectronApplication[] = [];
    await use(async () => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      const app = await electron.launch({
        args: [appDir, '--demo'],
        env: { ...env, RAML_KQL_CONFIG_DIR: configDir, NODE_ENV: 'production' },
      });
      launched.push(app);
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.getByTestId('workbench').waitFor();
      return { app, window };
    });
    for (const app of launched) {
      await app.close().catch(() => undefined);
    }
  },
  electronApp: async ({ launch }, use) => {
    const { app } = await launch();
    await use(app);
  },
  window: async ({ electronApp }, use) => {
    await use(await electronApp.firstWindow());
  },
});

export { expect } from '@playwright/test';

/** `ControlOrMeta` is Cmd on macOS and Ctrl elsewhere, like VS Code's CtrlCmd. */
export const MOD = 'ControlOrMeta';

/** The quick input's text box (command palette, quick open, pickers). */
export function quickInput(window: Page) {
  return window.getByRole('dialog', { name: 'Quick input' }).getByRole('combobox');
}

/** Write settings.jsonc into the throwaway config dir before launching. */
export function writeSettings(configDir: string, values: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tiny sync helper for tests
  const { writeFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(path.join(configDir, 'settings.jsonc'), JSON.stringify(values, null, 2));
}
