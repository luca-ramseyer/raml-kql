import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, MOD, test, writeSettings } from './fixtures';

/**
 * README screenshots, taken from the running app in demo mode (fake tenants, aliased names).
 * Skipped in normal runs. To refresh the images in docs/images/:
 *
 *   RAML_KQL_SCREENSHOTS=1 pnpm --filter @raml-kql/desktop test:e2e e2e/screenshots.spec.ts
 */
test.skip(process.env['RAML_KQL_SCREENSHOTS'] !== '1', 'only for refreshing the README images');

const OUT = path.resolve(__dirname, '../../../docs/images');
const pill = (window: Page) => window.locator('.run-pill');

async function resize(app: { evaluate: (fn: (e: unknown) => unknown) => Promise<unknown> }) {
  await app.evaluate((electron) => {
    const { BrowserWindow } = electron as {
      BrowserWindow: { getAllWindows(): { setSize(w: number, h: number): void }[] };
    };
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });
}

/** A taller results panel and a slimmer sidebar than the defaults, so the results are the star. */
function writeLayout(configDir: string): void {
  mkdirSync(path.join(configDir, 'state'), { recursive: true });
  writeFileSync(
    path.join(configDir, 'state', 'ui-layout.json'),
    JSON.stringify({
      sidebar: { visible: true, width: 260, activeView: 'workbench.view.targets' },
      panel: { visible: true, height: 440, maximized: false, activeTab: 'results' },
    }),
  );
}

/** Tidy the window for a screenshot: close the suggestion popup and toasts, enlarge the panel. */
async function tidy(window: Page): Promise<void> {
  await window.keyboard.press('Escape');
  const clear = window.getByRole('button', { name: 'Clear Notification' });
  while ((await clear.count()) > 0) await clear.first().click();
  await window.waitForTimeout(800);
}

async function run(window: Page, query: string, chart = false): Promise<void> {
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  if ((await window.locator('.query-monaco').count()) === 0) {
    await window.keyboard.press(`${MOD}+N`);
  }
  const editor = window.locator('.query-monaco .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await window.keyboard.press(`${MOD}+A`);
  await window.keyboard.press('Backspace');
  await window.keyboard.type(query);
  await window.keyboard.press('Shift+Enter');
  if (chart) {
    // Queries with `render` open the Chart tab, where the run pill isn't shown.
    await expect(window.getByRole('img', { name: 'Chart' })).toBeVisible({ timeout: 60_000 });
    return;
  }
  await expect(pill(window)).toContainText('10 ✓', { timeout: 60_000 });
  await expect(pill(window)).not.toContainText('running', { timeout: 60_000 });
}

for (const theme of ['Raml Dark', 'Raml Light'] as const) {
  test(`results across tenants (${theme})`, async ({ launch, configDir }) => {
    writeSettings(configDir, {
      'workbench.colorTheme': theme,
      'window.autoDetectColorScheme': false,
    });
    writeLayout(configDir);
    const { app, window } = await launch();
    await resize(app);
    await run(
      window,
      'Heartbeat\n| where TimeGenerated > ago(1d)\n| summarize Beats = count(), LastSeen = max(TimeGenerated) by Computer, Category\n| top 50 by Beats desc',
    );
    await tidy(window);
    await window.screenshot({
      path: path.join(OUT, `results-${theme === 'Raml Dark' ? 'dark' : 'light'}.png`),
    });
  });
}

test('chart and run status', async ({ launch, configDir }) => {
  writeSettings(configDir, {
    'workbench.colorTheme': 'Raml Dark',
    'window.autoDetectColorScheme': false,
  });
  writeLayout(configDir);
  const { app, window } = await launch();
  await resize(app);
  await run(
    window,
    'Heartbeat\n| summarize count() by bin(TimeGenerated, 1h)\n| render timechart',
    true,
  );
  await expect(window.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true');
  await window.waitForTimeout(2500); // let the last workspaces finish
  await tidy(window);
  await window.screenshot({ path: path.join(OUT, 'chart.png') });

  await window.getByRole('tab', { name: 'Run' }).click();
  await window.waitForTimeout(600);
  await window.screenshot({ path: path.join(OUT, 'run-status.png') });
});
