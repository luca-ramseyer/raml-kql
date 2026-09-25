import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import type { ElectronApplication, Page } from '@playwright/test';
import { zipSync } from 'fflate';

import { expect, MOD, quickInput, test, writeSettings } from './fixtures';

/**
 * Phase 9 acceptance in the running app (demo mode): an extension can't reach the network
 * without a grant, the permission prompt appears per query run by default, and "Always allow"
 * persists across a restart.
 */
const FIXTURE = path.resolve(__dirname, 'fixtures/extensions/net-probe');

function packFixture(target: string): void {
  const files: Record<string, Uint8Array> = {};
  const walk = (relative: string): void => {
    for (const name of readdirSync(path.join(FIXTURE, relative))) {
      const child = relative === '' ? name : `${relative}/${name}`;
      if (statSync(path.join(FIXTURE, child)).isDirectory()) walk(child);
      else files[child] = new Uint8Array(readFileSync(path.join(FIXTURE, child)));
    }
  };
  walk('');
  writeFileSync(target, zipSync(files));
}

let server: Server;
let origin = '';
const hits = { direct: 0, probe: 0 };

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/direct') hits.direct += 1;
    if (request.url === '/probe') hits.probe += 1;
    response.end('hello');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(() => {
  hits.direct = 0;
  hits.probe = 0;
});

async function runCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('F1');
  await quickInput(window).fill(`>${title}`);
  await window
    .getByRole('option', { name: new RegExp(title) })
    .first()
    .click();
}

async function installProbe(
  app: ElectronApplication,
  window: Page,
  configDir: string,
): Promise<void> {
  const file = path.join(configDir, 'net-probe.rkqlx');
  packFixture(file);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, file);
  await runCommand(window, 'Install from File');
  const install = window.getByRole('dialog', { name: 'Install Net Probe' });
  await expect(install).toContainText('Not verified by Raml KQL');
  await expect(install).toContainText('127.0.0.1');
  await install.getByRole('button', { name: 'Install' }).click();
  await expect(install).toBeHidden();
}

async function runQuery(window: Page): Promise<void> {
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);
  await window.keyboard.press(`${MOD}+N`);
  const editor = window.locator('.query-monaco .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await window.keyboard.press(`${MOD}+A`);
  await window.keyboard.type('Heartbeat | take 1');
  await window.keyboard.press('Shift+Enter');
  await expect(window.locator('.run-pill')).toContainText('✓', { timeout: 15_000 });
}

const prompt = (window: Page) =>
  window.getByRole('dialog', { name: 'Permission request from Net Probe' });
const result = (window: Page) => window.getByText(/Net Probe: direct/).last();

test('an extension cannot reach the network without a grant', async ({
  electronApp,
  window,
  configDir,
}) => {
  writeSettings(configDir, { 'net-probe.url': origin });
  await window.reload();
  await window.getByTestId('workbench').waitFor();
  await installProbe(electronApp, window, configDir);
  await runQuery(window);

  await runCommand(window, 'Net Probe: Fetch');
  await expect(prompt(window)).toContainText('wants to connect to the internet');
  await prompt(window).getByRole('button', { name: 'Deny' }).click();
  await expect(result(window)).toHaveText('Net Probe: direct blocked, api denied');
  expect(hits).toEqual({ direct: 0, probe: 0 });
});

test('the prompt appears per query run, and "Always allow" persists', async ({
  launch,
  configDir,
}) => {
  writeSettings(configDir, { 'net-probe.url': origin });
  const first = await launch();
  await installProbe(first.app, first.window, configDir);
  await runQuery(first.window);

  // Run 1: allowed for this run only; a second use in the same run doesn't ask again.
  await runCommand(first.window, 'Net Probe: Fetch');
  await prompt(first.window).getByRole('button', { name: 'Allow for This Run' }).click();
  await expect(result(first.window)).toHaveText('Net Probe: direct blocked, api 200 hello');
  await runCommand(first.window, 'Net Probe: Fetch');
  await expect.poll(() => hits.probe).toBe(2);
  await expect(prompt(first.window)).toBeHidden();

  // Run 2: asked again. "Always allow" is written to permissions.jsonc.
  await first.window.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(first.window.locator('.run-pill')).toContainText('✓', { timeout: 15_000 });
  await runCommand(first.window, 'Net Probe: Fetch');
  await prompt(first.window).getByRole('button', { name: 'Always Allow' }).click();
  await expect.poll(() => hits.probe).toBe(3);
  expect(readFileSync(path.join(configDir, 'permissions.jsonc'), 'utf8')).toContain(
    'contoso.net-probe',
  );
  await first.app.close();

  // After a restart: no prompt.
  const second = await launch();
  await runQuery(second.window);
  await runCommand(second.window, 'Net Probe: Fetch');
  await expect.poll(() => hits.probe).toBe(4);
  await expect(prompt(second.window)).toBeHidden();
  expect(hits.direct).toBe(0);

  // Revoking in the Extensions view brings the prompt back.
  await second.window.getByRole('tab', { name: 'Extensions' }).click();
  await second.window.getByRole('button', { name: /Net Probe/ }).click();
  await second.window
    .getByRole('list', { name: 'Grants of Net Probe' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await runCommand(second.window, 'Net Probe: Fetch');
  await expect(prompt(second.window)).toBeVisible();
});
