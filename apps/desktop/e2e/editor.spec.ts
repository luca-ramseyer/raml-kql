import type { Page } from '@playwright/test';

import { expect, MOD, quickInput, test, writeSettings } from './fixtures';

/**
 * Phase 4 acceptance: "In demo mode, completions list tables and columns from the fake schema.
 * Tables missing in some targets show 'available in 3/5 workspaces'." Runs against the built app,
 * so Monaco and the Kusto worker load under the production CSP.
 */

const editor = (window: Page) => window.locator('.query-monaco .monaco-editor');
const suggestions = (window: Page) => window.locator('.monaco-editor .suggest-widget');

async function newQuery(window: Page): Promise<void> {
  // Demo discovery fills Targets shortly after start; the schema follows the targets.
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  await window.keyboard.press(`${MOD}+N`);
  await expect(window.getByRole('tab', { name: /Query 1/ })).toBeVisible();
  await expect(editor(window)).toBeVisible();
}

/** Typing never waits for the schema; completion assertions do. */
async function schemaReady(window: Page): Promise<void> {
  await expect(window.locator('.query-monaco[data-schema="ready"]')).toBeVisible();
}

/** Replace the editor text by typing (Monaco reads real key events). */
async function setText(window: Page, text: string): Promise<void> {
  await editor(window).click();
  await window.keyboard.press(`${MOD}+A`);
  await window.keyboard.press('Backspace');
  await window.keyboard.type(text);
}

test('the first query opens with the sample query and "Set in query"', async ({ window }) => {
  const violations: string[] = [];
  window.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await newQuery(window);
  await expect(editor(window)).toContainText('SigninLogs');
  await expect(window.getByRole('button', { name: 'Time range: Set in query' })).toBeVisible();

  await setText(window, 'Heartbeat | take 10');
  await expect(window.getByRole('button', { name: 'Time range: Last 24 hours' })).toBeEnabled();
  expect(violations).toEqual([]);
});

test('completions list tables and columns from the demo schema', async ({ window }) => {
  await newQuery(window);
  await schemaReady(window);
  await setText(window, 'Heartb');
  await window.keyboard.press('Control+Space');
  await expect(suggestions(window)).toContainText('Heartbeat');

  await window.keyboard.press('Escape');
  await setText(window, 'Heartbeat | where Comp');
  await window.keyboard.press('Control+Space');
  await expect(suggestions(window)).toContainText('Computer');
});

test('tables missing in some targets show their availability', async ({ window }) => {
  await newQuery(window);
  await schemaReady(window);
  await setText(window, 'DevicePro');
  await window.keyboard.press('Control+Space');
  const row = suggestions(window).getByRole('option', { name: /DeviceProcessEvents/ });
  await expect(row).toBeVisible();
  // 3 of the 10 loadable demo targets have the Defender tables.
  await expect(row).toContainText('3/10');

  // Hovering the table shows the full hint.
  await window.keyboard.press('Escape');
  await setText(window, 'DeviceProcessEvents');
  await editor(window)
    .locator('.view-line span span', { hasText: 'DeviceProcessEvents' })
    .first()
    .hover();
  await expect(
    window.locator('.monaco-hover').filter({ hasText: 'Available in 3/10 selected workspaces' }),
  ).toBeVisible();
});

test('the time range picker offers presets and a custom range', async ({ window }) => {
  await newQuery(window);
  await setText(window, 'Heartbeat | take 10');
  await window.getByRole('button', { name: 'Time range: Last 24 hours' }).click();
  await quickInput(window).fill('7');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('button', { name: 'Time range: Last 7 days' })).toBeVisible();
});

test('completions follow a schema change for the word being typed', async ({
  launch,
  configDir,
}) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  const { window } = await launch();
  await newQuery(window);
  await schemaReady(window);
  await setText(window, 'DevicePro');
  await window.keyboard.press('Control+Space');
  await expect(suggestions(window)).toContainText('DeviceProcessEvents');
  await window.keyboard.press('Escape');

  // Only tenants without the Defender tables stay selected.
  for (const tenant of ['Contoso', 'Fabrikam', 'Woodgrove Bank']) {
    await window.getByRole('checkbox', { name: `Select all workspaces in ${tenant}` }).uncheck();
  }
  await editor(window).click();
  await window.keyboard.press('End');
  // Same word, same line: monaco-kusto would answer from its cache without the reset.
  await expect(async () => {
    await window.keyboard.press('Escape');
    await window.keyboard.press('Control+Space');
    await expect(suggestions(window)).not.toContainText('DeviceProcessEvents', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
});
