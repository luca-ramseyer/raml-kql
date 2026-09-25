import type { Page } from '@playwright/test';

import { expect, quickInput, test, writeSettings } from './fixtures';

/**
 * Phase 3 acceptance: "In demo mode, disabled workspaces disappear from Targets. Toggling
 * aliasing updates every visible name instantly. Groups select correctly."
 */

const targets = (window: Page) => window.getByRole('tree', { name: 'Targets' });
const workspaceRows = (window: Page) => targets(window).locator('[aria-level="2"]');

test('starts aliased; toggling shows real names everywhere at once', async ({ window }) => {
  await expect(workspaceRows(window)).toHaveCount(11);
  await expect(targets(window)).toContainText('Customer 0');
  await expect(window.locator('body')).not.toContainText('Contoso');
  await expect(window.locator('body')).not.toContainText('la-contoso');

  await window.getByRole('button', { name: 'Aliased', exact: true }).click();
  await quickInput(window).fill('');
  await window.getByRole('option', { name: /Show Real Names/ }).click();

  await expect(targets(window)).toContainText('Contoso');
  await expect(targets(window)).toContainText('la-contoso-soc');
  await window.getByRole('tab', { name: /^Accounts/ }).click();
  await expect(window.getByRole('tree', { name: 'Accounts' })).toContainText(
    'analyst@contoso.example',
  );

  await window.getByRole('button', { name: 'Real names', exact: true }).click();
  await expect(window.getByRole('tree', { name: 'Accounts' })).not.toContainText('contoso');
});

test('disabled workspaces disappear from Targets', async ({ launch, configDir }) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  const { window } = await launch();
  await expect(workspaceRows(window)).toHaveCount(11);

  await window.getByRole('button', { name: 'Workspaces Settings' }).click();
  await window.getByRole('checkbox', { name: 'Enable la-contoso-apps' }).uncheck();

  await expect(workspaceRows(window)).toHaveCount(10);
  await expect(targets(window)).not.toContainText('la-contoso-apps');
  await expect(window.getByRole('button', { name: /10 workspaces/ })).toBeVisible();
});

test('groups select exactly their workspaces', async ({ launch, configDir }) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
  const { window } = await launch();
  await expect(workspaceRows(window)).toHaveCount(11);

  await window.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'All Sentinel' });
  await expect(workspaceRows(window)).toHaveCount(6);
  await expect(window.getByText('6 of 6 selected')).toBeVisible();
  for (const row of await workspaceRows(window).all()) {
    await expect(row.locator('.targets-sentinel')).toHaveCount(1);
  }

  await window.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'On-call set' });
  await expect(workspaceRows(window)).toHaveCount(2);
});

test('signing in to a tenant that needed it discovers its workspaces', async ({ window }) => {
  await expect(workspaceRows(window)).toHaveCount(11);
  await window
    .getByRole('status', { name: /needs you to sign in again/ })
    .getByRole('button', { name: 'Sign in' })
    .click();
  await expect(workspaceRows(window)).toHaveCount(12);
});
