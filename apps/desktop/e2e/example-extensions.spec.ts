import path from 'node:path';

import type { ElectronApplication, Page } from '@playwright/test';

import { expect, MOD, quickInput, test } from './fixtures';

/**
 * The example extensions (examples/extensions, built by e2e/global-setup.ts) in the running
 * app: a result renderer in a sandboxed iframe, a theme, and an enricher's permission prompt.
 */
const DIST = path.resolve(__dirname, '../../../examples/extensions/dist');

async function runCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('F1');
  await quickInput(window).fill(`>${title}`);
  await window
    .getByRole('option', { name: new RegExp(title) })
    .first()
    .click();
}

async function install(
  app: ElectronApplication,
  window: Page,
  file: string,
  name: string,
): Promise<void> {
  await app.evaluate(
    ({ dialog }, target) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
    },
    path.join(DIST, file),
  );
  await runCommand(window, 'Install from File');
  const dialog = window.getByRole('dialog', { name: `Install ${name}` });
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog).toBeHidden();
}

async function runQuery(window: Page, text: string): Promise<void> {
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  await window.keyboard.press(`${MOD}+N`);
  const editor = window.locator('.query-monaco .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await window.keyboard.press(`${MOD}+A`);
  await window.keyboard.type(text);
  await window.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(window.locator('.run-pill')).toContainText('✓', { timeout: 15_000 });
}

test('the Country Map renderer draws the result after results.read is allowed', async ({
  electronApp,
  window,
}) => {
  await install(electronApp, window, 'country-map-renderer.rkqlx', 'Country Map');
  await runQuery(window, 'SigninLogs | take 50');
  await window.getByRole('tab', { name: 'Country Map' }).click();
  const prompt = window.getByRole('dialog', { name: 'Permission request from Country Map' });
  await expect(prompt).toContainText('read the full query results');
  await prompt.getByRole('button', { name: 'Allow for This Run' }).click();
  const frame = window.frameLocator('iframe[title="Country Map"]');
  await expect(frame.getByRole('img', { name: /Rows per country \(Location\)/ })).toBeVisible();
  await expect(frame.getByText('Top countries')).toBeVisible();
  await expect(frame.locator('.country.hit').first()).toBeVisible();
});

test('the Teal Dark example theme can be chosen', async ({ electronApp, window }) => {
  await install(electronApp, window, 'teal-theme.rkqlx', 'Teal Dark');
  await runCommand(window, 'Color Theme');
  await quickInput(window).fill('Teal');
  await window.getByRole('option', { name: /Teal Dark/ }).click();
  await expect(window.locator('html')).toHaveAttribute(
    'style',
    /--vscode-editor-background: #0f1a1e/,
  );
});

test('enriching with VirusTotal asks before any value leaves the app', async ({
  electronApp,
  window,
}) => {
  await install(electronApp, window, 'virustotal-enricher.rkqlx', 'VirusTotal Enricher');
  await runQuery(window, 'SigninLogs | project IPAddress | take 5');
  const cell = window
    .locator('.results-grid .ag-cell')
    .filter({ hasText: /^203\.0\.113\.\d+$/ })
    .first();
  await cell.click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Enrich Value with VirusTotal' }).click();
  const prompt = window.getByRole('dialog', {
    name: 'Permission request from VirusTotal Enricher',
  });
  await expect(prompt).toContainText(
    'send 1 value (IP addresses) from this result to www.virustotal.com',
  );
  await prompt.getByRole('button', { name: 'Deny' }).click();
  await expect(window.getByText('Permission denied: the values were not sent.')).toBeVisible();
});
