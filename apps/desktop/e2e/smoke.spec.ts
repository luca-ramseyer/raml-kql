import { expect, test } from './fixtures';

test('launches with the app title', async ({ window }) => {
  await expect(window).toHaveTitle('Raml KQL');
});

test('renderer reaches the main process over typed IPC in demo mode', async ({ window }) => {
  // `data-demo-mode` is only set after a successful `app:getInfo` round trip.
  await expect(window.locator('.workbench-root')).toHaveAttribute('data-demo-mode', 'true');
  await expect(window.getByRole('button', { name: 'Demo Mode', exact: true })).toBeVisible();
});

test('renderer has no Node.js access', async ({ window }) => {
  const globals = await window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    bridge: typeof (globalThis as Record<string, unknown>)['ramlKql'],
  }));
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });
});

test('workbench is served from the app protocol, not file://', ({ window }) => {
  expect(window.url()).toBe('raml-kql://app/index.html');
});
