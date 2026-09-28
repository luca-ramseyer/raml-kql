import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, MOD, quickInput, test } from './fixtures';

/**
 * Phase 7 in the running app (demo mode): tabs survive a restart without their results,
 * History search, and My Queries saved as files. Groups, persistence and history are covered
 * in depth by the unit tests (editors, tab-persistence, history-service, queries-service).
 */

const editor = (window: Page) => window.locator('.query-monaco .monaco-editor');

async function openQuery(window: Page, text: string): Promise<void> {
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  await window.keyboard.press(`${MOD}+N`);
  await expect(editor(window)).toBeVisible();
  await editor(window).click();
  await window.keyboard.press(`${MOD}+A`);
  await window.keyboard.press('Backspace');
  await window.keyboard.type(text);
}

async function run(window: Page): Promise<void> {
  await window.keyboard.press('Shift+Enter');
  await expect(window.locator('.run-pill')).toContainText('✓', { timeout: 15_000 });
}

test('restart restores tabs and their text, but not their results', async ({
  launch,
  configDir,
}) => {
  const first = await launch();
  await openQuery(first.window, 'Heartbeat | take 2');
  await run(first.window);
  await expect(first.window.getByText('20 rows')).toBeVisible();
  // Tabs are saved (debounced) to state/tabs.json.
  const tabsFile = path.join(configDir, 'state', 'tabs.json');
  await expect
    .poll(() => existsSync(tabsFile) && readFileSync(tabsFile, 'utf8'))
    .toContain('Heartbeat | take 2');
  // Targets and text only: no result columns or rows (spec 04).
  expect(readFileSync(tabsFile, 'utf8')).not.toMatch(/_TenantName|"rows"|"columns"/);
  await first.app.close();

  const second = await launch();
  await expect(second.window.getByRole('tab', { name: /Query 1/ })).toBeVisible();
  await expect(editor(second.window)).toContainText('Heartbeat | take 2');
  await expect(
    second.window.getByText('Results from the previous session were cleared.', { exact: false }),
  ).toBeVisible();
  await expect(second.window.locator('.run-pill')).toHaveCount(0);
});

test('history records runs and search filters them', async ({ window }) => {
  await openQuery(window, 'Heartbeat | take 1');
  await run(window);
  await openQuery(window, 'SigninLogs | take 1');
  await run(window);

  await window.getByRole('tab', { name: 'History' }).click();
  const history = window.getByRole('tree', { name: 'History' });
  await expect(history.locator('.history-entry')).toHaveCount(2);
  await window.getByLabel('Search history').fill('signin');
  await expect(history.locator('.history-entry')).toHaveCount(1);
  await expect(history).toContainText('SigninLogs | take 1');

  // Opening an entry brings the query back in a tab.
  await history.locator('.history-entry').dblclick();
  await expect(editor(window)).toContainText('SigninLogs | take 1');
});

test('Save writes the tab to My Queries as a .kql file', async ({ window, configDir }) => {
  await openQuery(window, 'SigninLogs\n| where ResultType != "0"');
  await window.keyboard.press(`${MOD}+S`);
  await quickInput(window).fill('Failed sign-ins');
  await window.keyboard.press('Enter');

  const file = path.join(configDir, 'queries', 'failed-sign-ins.kql');
  await expect.poll(() => existsSync(file)).toBe(true);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('// name: Failed sign-ins');
  expect(text).toContain('SigninLogs');
  await expect(window.getByRole('tab', { name: /Failed sign-ins/ })).toBeVisible();

  await window.getByRole('tab', { name: 'Library' }).click();
  await expect(window.getByRole('tree', { name: 'My Queries' })).toContainText('Failed sign-ins');

  // A second save overwrites the linked file instead of asking again.
  await editor(window).click();
  await window.keyboard.press(`${MOD}+End`);
  await window.keyboard.type('\n| take 5');
  await window.keyboard.press(`${MOD}+S`);
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('| take 5');
  expect(readdirSync(path.join(configDir, 'queries'))).toEqual(['failed-sign-ins.kql']);
});
