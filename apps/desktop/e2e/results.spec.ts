import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ElectronApplication, Page } from '@playwright/test';

import { expect, MOD, quickInput, test, writeSettings } from './fixtures';

/**
 * Phase 6 acceptance: "A 500k-row demo result scrolls smoothly. Each render type draws. Exports
 * round-trip in tests." (Format round-trips are unit-tested in src/main/export.)
 */

const grid = (window: Page) => window.locator('.results-grid').getByRole('grid');
const pill = (window: Page) => window.locator('.run-pill');
const count = (window: Page) => window.locator('.results-count');

async function run(window: Page, query: string, expected: string | null = '10 ✓'): Promise<void> {
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
  if (expected === null) return;
  await expect(pill(window)).toContainText(expected, { timeout: 60_000 });
  await expect(pill(window)).not.toContainText('running', { timeout: 60_000 });
}

async function realNames({
  launch,
  configDir,
}: {
  launch: () => Promise<{ app: ElectronApplication; window: Page }>;
  configDir: string;
}) {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  return launch();
}

test('a 500k-row result scrolls, sorts and searches', async ({ window }) => {
  await run(window, 'Heartbeat | take 50000');
  await expect(count(window)).toHaveText('500,000 rows');

  // Scroll to the end: only the blocks on screen are fetched, so the last rows appear quickly.
  const viewport = window.locator('.results-grid .ag-body-vertical-scroll-viewport');
  const started = Date.now();
  await viewport.evaluate((element: { scrollTop: number; scrollHeight: number }) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(grid(window).locator('[row-index="499999"]')).toBeVisible({ timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  await viewport.evaluate((element: { scrollTop: number; scrollHeight: number }) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(grid(window).locator('[row-index="250000"]')).toBeVisible({ timeout: 5000 });

  // Sort by a column (computed next to the data in the main process).
  const header = grid(window).getByRole('columnheader', { name: /ComputerIP/ });
  const colId = (await header.getAttribute('col-id')) ?? '';
  await header.click();
  // Ascending text sort: 203.0.113.105 comes first of the demo addresses (7, 14, …, 140).
  await expect(grid(window).locator(`[row-index="0"] [col-id="${colId}"]`)).toHaveText(
    '203.0.113.105',
  );

  await window.getByRole('searchbox', { name: 'Search results' }).fill('OSType-13');
  await expect(count(window)).toHaveText(/^[\d,]+ of 500,000 rows$/);
});

test('filter to a value, row details and group by tenant', async ({ launch, configDir }) => {
  const { window } = await realNames({ launch, configDir });
  await run(window, 'Heartbeat | take 20');
  await expect(count(window)).toHaveText('200 rows');

  const cell = grid(window).locator('[row-index="0"] [col-id="c0"]');
  const tenant = (await cell.textContent()) ?? '';
  await cell.click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Filter to This Value' }).click();
  await expect(count(window)).toHaveText(/^\d+ of 200 rows$/);
  await expect(window.locator('.value-filter-chip')).toContainText(`_TenantName = ${tenant}`);
  const matching = Number(/^(\d+)/.exec((await count(window).textContent()) ?? '')?.[1]);

  await grid(window).locator('[row-index="0"] [col-id="c0"]').dblclick();
  const details = window.getByRole('complementary', { name: 'Row details' });
  await expect(details).toContainText('_WorkspaceName');
  await expect(details).toContainText(tenant);

  await window.getByRole('button', { name: 'Group', exact: true }).first().click();
  await window.getByRole('button', { name: 'Group by Tenant' }).click();
  const grouped = window.locator('.results-grid[aria-label="Grouped view"]').getByRole('grid');
  await expect(grouped.getByRole('row', { name: `${tenant} ${String(matching)}` })).toBeVisible();
  await expect(count(window)).toHaveText(/^1 group\b/);
});

test('render types draw, and the chart builder switches chart types', async ({ window }) => {
  await run(
    window,
    'Heartbeat | summarize count() by bin(TimeGenerated, 1h) | render timechart',
    null,
  );
  // Queries with `render` open the Chart tab.
  await expect(window.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true');
  const chart = window.getByRole('img', { name: 'Chart' });
  await expect(chart.locator('canvas')).toBeVisible();
  await expect(window.getByLabel('Chart type')).toHaveValue('');

  for (const kind of ['column', 'bar', 'pie', 'area', 'stackedArea', 'scatter', 'line']) {
    await window.getByLabel('Chart type').selectOption(kind);
    await expect(chart.locator('canvas')).toBeVisible();
  }
  await window.getByLabel('Chart type').selectOption('card');
  await expect(window.getByLabel('Card')).toBeVisible();
});

test('exports to a file and copies as Markdown', async ({ launch, configDir }) => {
  const { app, window } = await realNames({ launch, configDir });
  const file = path.join(configDir, 'export.csv');
  await app.evaluate(({ dialog }, target) => {
    // Stand-in for the native save dialog, which tests can't click.
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, file);
  await run(window, 'Heartbeat | take 2');

  await window.getByRole('button', { name: 'Export results' }).click();
  await quickInput(window).fill('CSV');
  await window.keyboard.press('Enter');
  await window.getByRole('option', { name: /Visible columns/ }).click();
  await window.getByRole('option', { name: /Real names/ }).click();
  await expect(window.getByText(/Exported 20 rows to/)).toBeVisible();
  const csv = readFileSync(file, 'utf8');
  expect(csv.startsWith('﻿_TenantName,_WorkspaceName,TimeGenerated,Computer')).toBe(true);
  expect(csv.trim().split('\r\n')).toHaveLength(21);

  await window.getByRole('button', { name: 'Copy results as' }).click();
  await quickInput(window).fill('Markdown');
  await window.keyboard.press('Enter');
  await window.getByRole('option', { name: /Visible columns/ }).click();
  await expect(window.getByText(/Copied 20 rows as Markdown Table/)).toBeVisible();
  const markdown = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(markdown.split('\n')[0]).toBe(
    '| _TenantName | _WorkspaceName | TimeGenerated | Computer | OSType | Version | ComputerIP | Category | TenantId | Type |',
  );
});
