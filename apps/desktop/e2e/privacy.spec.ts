import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, MOD, quickInput, test, writeSettings } from './fixtures';

/**
 * Phase 10 in the running app (demo mode): masking rules on result cells in presentation mode,
 * the crash report flow after an unexpected exit, and the Network Activity view.
 */
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

async function runCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('F1');
  await quickInput(window).fill(`>${title}`);
  await window
    .getByRole('option', { name: new RegExp(title) })
    .first()
    .click();
}

test('masking rules hide customer text in result cells while presentation mode is on', async ({
  launch,
  configDir,
}) => {
  writeSettings(configDir, {
    'privacy.maskingRules': [{ match: 'fabrikam.example', replace: 'customer02.example' }],
    'privacy.aliasing.confirmReveal': false,
  });
  const { window } = await launch();
  await runQuery(window, 'SigninLogs | project UserPrincipalName | take 20');
  const grid = window.locator('.results-grid');
  await expect(grid).toContainText('@customer02.example');
  await expect(grid).not.toContainText('@fabrikam.example');
  // Searching for the real text finds nothing while it's masked.
  await window.getByLabel('Search results').fill('fabrikam.example');
  await expect(window.getByText(/^0 of [\d,]+ rows$/)).toBeVisible();
  await window.getByLabel('Search results').fill('');

  // Real names: the rule no longer applies.
  await window.keyboard.press(`${MOD}+Alt+P`);
  await expect(window.getByText('Real names')).toBeVisible();
  await expect(grid).toContainText('@fabrikam.example');
});

test('after an unexpected exit, a sanitized report can be previewed and filed on GitHub', async ({
  launch,
  configDir,
}) => {
  const first = await launch();
  // An error in the workbench that mentions personal data.
  await first.window.evaluate(() => {
    setTimeout(() => {
      throw new Error('boom for alice@contoso.com in tenant 00000000-0000-0000-0000-0000000000a1');
    }, 0);
  });
  const crashes = path.join(configDir, 'state', 'crashes');
  await expect.poll(() => readdirSync(crashes).filter((f) => f.endsWith('.json')).length).toBe(1);
  const onDisk = readFileSync(
    path.join(crashes, readdirSync(crashes).find((f) => f.endsWith('.json')) ?? ''),
    'utf8',
  );
  expect(onDisk).toContain('boom for <email> in tenant <guid>');
  expect(onDisk).not.toContain('alice@contoso.com');
  // Kill the app: no clean shutdown.
  first.app.process().kill('SIGKILL');

  const second = await launch();
  const toast = second.window.getByText('Raml KQL closed unexpectedly. Report the problem?');
  await expect(toast).toBeVisible();
  await second.window.getByRole('button', { name: 'Preview & Report on GitHub' }).click();
  const report = second.window.getByRole('textbox', { name: 'Report' });
  await expect(report).toHaveValue(/boom for <email> in tenant <guid>/);
  await expect(report).toHaveValue(/The previous session ended unexpectedly/);

  await second.app.evaluate(({ shell }) => {
    (globalThis as unknown as { opened: string[] }).opened = [];
    shell.openExternal = (url: string) => {
      (globalThis as unknown as { opened: string[] }).opened.push(url);
      return Promise.resolve();
    };
  });
  await report.fill(`${await report.inputValue()}\nMy note: it happened for bob@contoso.com`);
  await second.window.getByRole('button', { name: 'Open GitHub Issue' }).click();
  const openedUrls = () =>
    second.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
  await expect.poll(openedUrls).toHaveLength(1);
  const opened = (await openedUrls())[0] ?? '';
  expect(opened.startsWith('https://github.com/luca-ramseyer/raml-kql/issues/new?')).toBe(true);
  const params = new URL(opened).searchParams;
  expect(params.get('body')).toContain('My note: it happened for <email>');
  expect(params.get('body')).not.toContain('contoso.com');
});

test('Developer: Show Network Activity lists what was contacted (nothing in demo mode)', async ({
  window,
}) => {
  await runCommand(window, 'Show Network Activity');
  await expect(window.getByRole('heading', { name: 'Network Activity' })).toBeVisible();
  await expect(window.getByText('No network requests yet.')).toBeVisible();
});
