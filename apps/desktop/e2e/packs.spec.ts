import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

import { createRepo, startGitServer, type GitServer } from '../test/helpers/git-server';

import { expect, quickInput, test } from './fixtures';

/**
 * Phase 8 in the running app (demo mode): the example pack installs from a local bare git
 * repository, runs with parameters and updates after review; a .rkqlpack imports from a file.
 */
const PACK_DIR = path.resolve(__dirname, '../../../examples/packs/raml.starter');

function packFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (relative: string): void => {
    for (const name of readdirSync(path.join(PACK_DIR, relative))) {
      const child = relative === '' ? name : `${relative}/${name}`;
      if (statSync(path.join(PACK_DIR, child)).isDirectory()) walk(child);
      else files[child] = readFileSync(path.join(PACK_DIR, child), 'utf8');
    }
  };
  walk('');
  return files;
}

async function runCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('F1');
  await quickInput(window).fill(`>${title}`);
  await window
    .getByRole('option', { name: new RegExp(title) })
    .first()
    .click();
}

const packsTree = (window: Page) => window.getByRole('tree', { name: 'Packs' });

let root: string;
let server: GitServer;

test.beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'raml-kql-e2e-git-'));
  server = await startGitServer(root);
});

test.afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

test('the example pack installs from git, runs with parameters and updates after review', async ({
  window,
}) => {
  const repo = createRepo(root, 'starter');
  repo.commit(packFiles(), 'Starter pack 1.0.0');
  await expect(
    window.getByRole('tree', { name: 'Targets' }).locator('[aria-level="2"]'),
  ).toHaveCount(11);

  // Add the source: preview first, then Add.
  await runCommand(window, 'Add Pack Source');
  await quickInput(window).fill(server.url('starter'));
  await window.keyboard.press('Enter');
  await expect(window.getByRole('option', { name: /Starter Hunting Pack 1\.0\.0/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(window.getByRole('option', { name: /11 queries/ })).toBeVisible();
  await window.getByRole('option', { name: /Add Source/ }).click();

  await window.getByRole('tab', { name: 'Library' }).click();
  await expect(packsTree(window)).toContainText('Starter Hunting Pack');
  await expect(packsTree(window)).toContainText('1.0.0');

  // Open a query: its parameters appear above the editor; the user presses Run.
  await packsTree(window).getByText('Failed sign-ins by user').dblclick();
  const parameters = window.getByRole('group', { name: 'Query parameters' });
  await expect(parameters).toBeVisible();
  const minFailures = parameters.getByRole('textbox', { name: 'MinFailures' });
  await expect(minFailures).toHaveValue('10');
  await minFailures.fill('25');
  await parameters.getByRole('textbox', { name: 'UserFilter' }).fill('o"brien');
  await window.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(window.locator('.run-pill')).toContainText('✓', { timeout: 15_000 });

  // What ran: the parameters as typed `let` statements replacing the portable defaults.
  await window.getByRole('tab', { name: 'History' }).click();
  const entry = window.getByRole('tree', { name: 'History' }).locator('.history-entry').first();
  await expect(entry).toHaveAttribute('title', /let MinFailures = long\(25\);/);
  await expect(entry).toHaveAttribute('title', /let UserFilter = "o\\"brien";/);
  await expect(entry).not.toHaveAttribute('title', /let MinFailures = 10;/);

  // Upstream publishes 1.1.0; nothing changes until the update is reviewed and applied.
  const files = packFiles();
  repo.commit(
    {
      'rkqlpack.yaml': (files['rkqlpack.yaml'] ?? '').replace('version: 1.0.0', 'version: 1.1.0'),
      'queries/mfa-fatigue.kql': (files['queries/mfa-fatigue.kql'] ?? '').replace(
        'default: 5',
        'default: 3',
      ),
      'queries/heartbeat-count.kql': [
        '// ---',
        '// id: heartbeat-count',
        '// name: Heartbeats per computer',
        '// description: How many heartbeats each computer sent.',
        '// category: health',
        '// tables: [Heartbeat]',
        '// ---',
        'Heartbeat',
        '| where TimeGenerated > ago(1d)',
        '| summarize count() by Computer',
        '',
      ].join('\n'),
    },
    'Lower the MFA threshold, add heartbeat count',
  );
  await runCommand(window, 'Check for Pack Updates');
  // One source with an update: its review opens.
  await expect(window.getByText('Lower the MFA threshold, add heartbeat count')).toBeVisible({
    timeout: 20_000,
  });
  await expect(window.getByText(/Starter Hunting Pack 1\.0\.0 → 1\.1\.0/)).toBeVisible();
  const changes = window.getByRole('listbox', { name: 'Changed queries' });
  await expect(changes.getByRole('option')).toHaveCount(2);
  await expect(changes).toContainText('Heartbeats per computer');
  await expect(changes).toContainText('Repeated MFA denials');
  await window.getByRole('button', { name: 'Apply Update' }).click();

  await window.getByRole('tab', { name: 'Library' }).click();
  await expect(packsTree(window)).toContainText('1.1.0');
  await expect(packsTree(window)).toContainText('Heartbeats per computer');
});

test('a .rkqlpack imports from a file after preview', async ({
  electronApp,
  window,
  configDir,
}) => {
  const zipPath = path.join(configDir, 'starter.rkqlpack');
  const zipped: Record<string, Uint8Array> = {};
  for (const [file, text] of Object.entries(packFiles()))
    zipped[`raml.starter/${file}`] = strToU8(text);
  writeFileSync(zipPath, zipSync(zipped));
  // Stand in for the OS file dialog.
  await electronApp.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, zipPath);

  await runCommand(window, 'Import Pack or Queries from File');
  await expect(window.getByRole('option', { name: /Starter Hunting Pack 1\.0\.0/ })).toBeVisible();
  await window.getByRole('option', { name: /Add Source/ }).click();
  await window.getByRole('tab', { name: 'Library' }).click();
  await expect(packsTree(window)).toContainText('Starter Hunting Pack');
  const sources = readFileSync(path.join(configDir, 'sources.jsonc'), 'utf8');
  expect(sources).toContain('"type": "file"');
  expect(sources).toContain('starter.rkqlpack');
});
