import path from 'node:path';

import type { ElectronApplication, Page } from '@playwright/test';

import { expect, MOD, packTestExtension, quickInput, test } from './fixtures';

/**
 * Extension contributions in the running app (demo mode), with the small test extensions in
 * e2e/fixtures/extensions: a result renderer in a sandboxed iframe, a theme, and an enricher's
 * permission prompt and result columns. The project's real example extensions live in the
 * raml-kql-extensions repository.
 */
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
  configDir: string,
  fixture: string,
  name: string,
): Promise<void> {
  const file = path.join(configDir, `${fixture}.rkqlx`);
  packTestExtension(fixture, file);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, file);
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

async function openIpCellMenu(window: Page): Promise<void> {
  const cell = window
    .locator('.results-grid .ag-cell')
    .filter({ hasText: /^203\.0\.113\.\d+$/ })
    .first();
  await cell.click({ button: 'right' });
}

test('a result renderer draws the result after results.read is allowed', async ({
  electronApp,
  window,
  configDir,
}) => {
  await install(electronApp, window, configDir, 'test-renderer', 'Row Counter');
  await runQuery(window, 'SigninLogs | take 50');
  await window.getByRole('tab', { name: 'Row Counter' }).click();
  const prompt = window.getByRole('dialog', { name: 'Permission request from Row Counter' });
  await expect(prompt).toContainText('read the full query results');
  await prompt.getByRole('button', { name: 'Allow for This Run' }).click();
  const frame = window.frameLocator('iframe[title="Row Counter"]');
  await expect(frame.getByRole('heading', { name: /^\d+ rows$/ })).toBeVisible();
  await expect(frame.getByText(/Columns: .*IPAddress/)).toBeVisible();
});

test('a theme from an extension can be chosen', async ({ electronApp, window, configDir }) => {
  await install(electronApp, window, configDir, 'test-theme', 'Contoso Night');
  await runCommand(window, 'Color Theme');
  await quickInput(window).fill('Contoso');
  await window.getByRole('option', { name: /Contoso Night/ }).click();
  await expect(window.locator('html')).toHaveAttribute(
    'style',
    /--vscode-editor-background: #101c2c/,
  );
});

test('an enricher asks before any value leaves the app', async ({
  electronApp,
  window,
  configDir,
}) => {
  await install(electronApp, window, configDir, 'test-enricher', 'Address Facts');
  await runQuery(window, 'SigninLogs | project IPAddress | take 5');
  await openIpCellMenu(window);
  await window.getByRole('menuitem', { name: 'Enrich Value with Address Facts' }).click();
  const prompt = window.getByRole('dialog', { name: 'Permission request from Address Facts' });
  await expect(prompt).toContainText(
    'send 1 value (IP addresses) from this result to facts.contoso.example',
  );
  await prompt.getByRole('button', { name: 'Deny' }).click();
  await expect(window.getByText('Permission denied: the values were not sent.')).toBeVisible();
});

test('Enrich Column adds the enricher columns for the whole column', async ({
  electronApp,
  window,
  configDir,
}) => {
  await install(electronApp, window, configDir, 'test-enricher', 'Address Facts');
  await runQuery(window, 'SigninLogs | project IPAddress | take 20');
  await openIpCellMenu(window);
  await window.getByRole('menuitem', { name: 'Enrich Column with Address Facts' }).click();
  const prompt = window.getByRole('dialog', { name: 'Permission request from Address Facts' });
  await prompt.getByRole('button', { name: 'Allow for This Run' }).click();
  await expect(window.getByText(/Address Facts: enriched \d+ of \d+ IP addresses\./)).toBeVisible();
  await window
    .locator('.ag-body-horizontal-scroll-viewport')
    .evaluate((el: { scrollLeft: number; scrollWidth: number }) => {
      el.scrollLeft = el.scrollWidth;
    });
  await expect(window.locator('.enrichment-header').first()).toContainText('Address Facts: family');
  await expect(
    window.locator('.cell-enrichment').filter({ hasText: 'IPv4' }).first(),
  ).toBeVisible();
});
