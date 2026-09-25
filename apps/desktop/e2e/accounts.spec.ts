import { expect, test, writeSettings } from './fixtures';

// These tests check real account and tenant names; aliasing has its own e2e test.
test.beforeEach(({ configDir }) => {
  writeSettings(configDir, { 'privacy.aliasing.activeOnStartup': false });
});

/** Phase 2 acceptance: "In demo mode, 2 fake accounts with 3 tenants are shown." */

test('demo mode shows 2 accounts with 3 tenants', async ({ launch }) => {
  const { window } = await launch();
  await window.getByRole('tab', { name: /^Accounts/ }).click();
  const tree = window.getByRole('tree', { name: 'Accounts' });
  await expect(tree.getByRole('treeitem', { level: 1 })).toHaveCount(2);
  await expect(tree.getByRole('treeitem', { level: 2 })).toHaveCount(3);
  await expect(tree).toContainText('analyst@contoso.example');
  await expect(tree).toContainText('guest@woodgrove.example');
  for (const tenant of ['Contoso', 'Northwind Traders', 'Woodgrove Bank']) {
    await expect(tree).toContainText(tenant);
  }
});

test('a tenant that needs sign-in is badged, notified once, and resolved by signing in', async ({
  launch,
}) => {
  const { window } = await launch();
  const accountsTab = window.getByRole('tab', { name: /^Accounts/ });
  await expect(accountsTab).toHaveAttribute('title', /1 needs attention/);
  const notification = window.getByRole('status', {
    name: /Northwind Traders needs you to sign in again/,
  });
  await expect(notification).toBeVisible();

  await notification.getByRole('button', { name: 'Sign in' }).click();
  await expect(accountsTab).toHaveAttribute('title', 'Accounts');
  await accountsTab.click();
  await expect(
    window.getByRole('tree', { name: 'Accounts' }).getByRole('button', { name: 'Sign in' }),
  ).toHaveCount(0);
});

test('demo accounts never touch the real accounts.jsonc', async ({ launch, configDir }) => {
  const { window } = await launch();
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  await window.getByRole('tab', { name: /^Accounts/ }).click();
  await expect(window.getByRole('tree', { name: 'Accounts' })).toBeVisible();
  expect(existsSync(path.join(configDir, 'accounts.jsonc'))).toBe(false);
});
