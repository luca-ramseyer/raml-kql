import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, MOD, test, writeSettings } from './fixtures';

/**
 * Phase 5 in the running app (demo mode): fan-out with per-workspace outcomes, merged results
 * with attribution, the syntax pre-flight, cancellation and "Re-run Failed". The engine's
 * fault handling is covered in depth by src/main/query/query-engine.test.ts.
 */

const editor = (window: Page) => window.locator('.query-monaco .monaco-editor');
const resultsTable = (window: Page) => window.getByRole('table', { name: 'Results' });
const runTable = (window: Page) => window.getByRole('table', { name: 'Workspace status' });

async function openQuery(window: Page, text?: string): Promise<void> {
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  await window.keyboard.press(`${MOD}+N`);
  await expect(editor(window)).toBeVisible();
  if (text !== undefined) {
    await editor(window).click();
    await window.keyboard.press(`${MOD}+A`);
    await window.keyboard.press('Backspace');
    await window.keyboard.type(text);
  }
}

test('runs across all targets and merges results with attribution', async ({
  launch,
  configDir,
}) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  const { window } = await launch();
  await openQuery(window, 'Heartbeat | take 3');
  await window.keyboard.press('Shift+Enter');

  const pill = window.locator('.run-pill');
  await expect(pill).toContainText('10 ✓', { timeout: 15_000 });
  await expect(pill).toContainText('1 failed');
  await expect(window.getByText('Demo data')).toBeVisible();
  await expect(window.getByText('30 rows')).toBeVisible();
  await expect(resultsTable(window).locator('th').first()).toHaveText('_TenantName');
  await expect(resultsTable(window)).toContainText('Contoso');
  await expect(resultsTable(window)).toContainText('la-contoso-soc');

  await pill.click();
  const tailspin = runTable(window).locator('tr', { hasText: 'la-tailspin-sentinel' });
  await expect(tailspin).toContainText('Failed');
  await expect(tailspin).toContainText('InsufficientAccessError');
  // Throttled once, then retried.
  const woodgrove = runTable(window).locator('tr', { hasText: 'la-woodgrove-sentinel' });
  await expect(woodgrove).toContainText('Succeeded');
  await expect(woodgrove.locator('td').nth(6)).toHaveText('2');
});

test('attribution follows presentation mode', async ({ window }) => {
  await openQuery(window, 'Heartbeat | take 1');
  await window.keyboard.press('Shift+Enter');
  await expect(window.locator('.run-pill')).toContainText('10 ✓', { timeout: 15_000 });
  await expect(resultsTable(window)).toContainText('Customer 0');
  await expect(resultsTable(window)).not.toContainText('Contoso');
  await expect(resultsTable(window)).not.toContainText('la-contoso');
});

test('a table missing in some workspaces fails only there', async ({ window }) => {
  await openQuery(window, 'DeviceProcessEvents | take 2');
  await window.keyboard.press('Shift+Enter');
  const pill = window.locator('.run-pill');
  await expect(pill).toContainText('3 ✓', { timeout: 15_000 });
  await expect(pill).toContainText('8 failed');
  await pill.click();
  await expect(runTable(window)).toContainText(
    "Failed to resolve table or column expression named 'DeviceProcessEvents'",
  );
});

test('syntax errors block the run', async ({ window }) => {
  await openQuery(window, 'Heartbeat | where');
  await window.keyboard.press('Shift+Enter');
  await expect(
    window.getByText(/Syntax error on line 1: .* The query was not sent\./),
  ).toBeVisible();
  await expect(window.locator('.run-pill')).toHaveCount(0);
});

test('Escape cancels a running query', async ({ window }) => {
  await openQuery(window, 'Heartbeat | take 1');
  await window.keyboard.press('Shift+Enter');
  // The slow demo workspace (2.5 s) is still running.
  await expect(window.getByRole('button', { name: 'Cancel', exact: true }).first()).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.locator('.run-pill')).toContainText('cancelled', { timeout: 10_000 });
  await expect(window.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
});

test('Re-run Failed runs only the failed workspaces again', async ({ launch, configDir }) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  const { window } = await launch();
  await openQuery(window, 'Heartbeat | take 1');
  await window.keyboard.press('Shift+Enter');
  const pill = window.locator('.run-pill');
  await expect(pill).toContainText('10 ✓ · 1 failed', { timeout: 15_000 });
  await pill.click();
  await window.getByRole('button', { name: 'Re-run Failed', exact: true }).click();
  const tailspin = runTable(window).locator('tr', { hasText: 'la-tailspin-sentinel' });
  await expect(tailspin).toContainText('Failed');
  await expect(pill).toHaveCount(0); // the Run tab is showing
  await expect(window.getByRole('status').filter({ hasText: '10 ✓ · 1 failed' })).toBeVisible();
});

test('the session result cache is gone after quit', async ({ launch }) => {
  const { app, window } = await launch();
  await openQuery(window, 'Heartbeat | take 1');
  await window.keyboard.press('Shift+Enter');
  await expect(window.locator('.run-pill')).toContainText('10 ✓', { timeout: 15_000 });

  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  const cache = path.join(userData, 'session-cache');
  expect(readdirSync(cache)).toHaveLength(1); // this session's folder
  await app.close();
  expect(existsSync(cache) ? readdirSync(cache) : []).toEqual([]);
});
