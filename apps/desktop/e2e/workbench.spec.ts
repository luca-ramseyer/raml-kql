import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, MOD, test } from './fixtures';

/** Phase 1 acceptance (docs/spec/00-roadmap.md). */

const editorBackground = (window: Page): Promise<string> =>
  // A string expression: this runs in the renderer, and the e2e tsconfig has no DOM types.
  window.evaluate<string>(
    "document.documentElement.style.getPropertyValue('--vscode-editor-background')",
  );

test('command palette runs "Toggle Primary Side Bar"', async ({ window }) => {
  const sidebar = window.getByRole('complementary', { name: 'Targets view' });
  await expect(sidebar).toBeVisible();

  await window.keyboard.press(`${MOD}+Shift+P`);
  const input = window.getByRole('combobox');
  await expect(input).toHaveValue('>');
  await input.pressSequentially('toggle primary side bar');
  await expect(window.getByRole('option').first()).toContainText(
    'View: Toggle Primary Side Bar Visibility',
  );
  await window.keyboard.press('Enter');

  await expect(input).toBeHidden();
  await expect(sidebar).toBeHidden();
});

test('F1 opens the palette and Escape closes it', async ({ window }) => {
  await window.keyboard.press('F1');
  await expect(window.getByRole('combobox')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByRole('combobox')).toBeHidden();
});

test('changes the theme via the Settings UI and writes settings.jsonc', async ({
  window,
  configDir,
}) => {
  await window.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => editorBackground(window)).toBe('#1f1f1f');

  await window.keyboard.press(`${MOD}+,`);
  await expect(window.getByRole('tab', { name: /Settings/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await window.getByRole('searchbox', { name: 'Search settings' }).fill('color theme');

  // Stop following the OS, then pick a theme explicitly.
  await window
    .getByRole('group', { name: 'Window: Auto Detect Color Scheme' })
    .first()
    .getByRole('checkbox')
    .uncheck();
  await window
    .getByRole('group', { name: 'Workbench: Color Theme' })
    .first()
    .getByRole('combobox')
    .selectOption('Default Light Modern');

  await expect.poll(() => editorBackground(window)).toBe('#ffffff');
  // The UI updates optimistically; the file write follows shortly after.
  const settingsFile = (): string => {
    try {
      return readFileSync(path.join(configDir, 'settings.jsonc'), 'utf8');
    } catch {
      return '';
    }
  };
  await expect.poll(settingsFile).toContain('"window.autoDetectColorScheme": false');
  await expect.poll(settingsFile).toContain('"workbench.colorTheme": "Default Light Modern"');
});

test('applies external edits to settings.jsonc live', async ({ window, configDir }) => {
  writeFileSync(
    path.join(configDir, 'settings.jsonc'),
    `{
  // edited outside the app, e.g. by a dotfiles repo
  "window.autoDetectColorScheme": false,
  "window.autoDetectHighContrast": false,
  "workbench.colorTheme": "Default High Contrast",
}
`,
  );
  await expect.poll(() => editorBackground(window)).toBe('#000000');
  await expect(window.locator('body')).toHaveClass(/hc-black/);

  // A broken file keeps the last valid settings and shows an error notification.
  writeFileSync(path.join(configDir, 'settings.jsonc'), '{ "workbench.colorTheme": ');
  await expect(window.getByRole('alert').first()).toContainText('settings.jsonc has errors');
  await expect(window.locator('body')).toHaveClass(/hc-black/);
});

test('user keybindings in keybindings.jsonc apply live', async ({ window, configDir }) => {
  writeFileSync(
    path.join(configDir, 'keybindings.jsonc'),
    '[{ "key": "ctrl+alt+b", "command": "workbench.action.toggleSidebarVisibility" }]',
  );
  const sidebar = window.getByRole('complementary');
  await expect(sidebar).toBeVisible();
  await expect(async () => {
    await window.keyboard.press('Control+Alt+B');
    await expect(sidebar).toBeHidden({ timeout: 500 });
  }).toPass();
});

test('sidebar and panel state persist across restarts', async ({ launch }) => {
  const first = await launch();
  await first.window.keyboard.press(`${MOD}+J`);
  await expect(first.window.getByRole('region', { name: 'Panel' })).toBeHidden();
  // Layout is saved debounced; wait until it reaches disk before quitting.
  await first.window.waitForTimeout(600);
  await first.app.close();

  const second = await launch();
  await expect(second.window.getByRole('region', { name: 'Panel' })).toBeHidden();
  await expect(second.window.getByRole('complementary')).toBeVisible();
});

test('application menu: native on macOS, custom menu bar elsewhere', async ({
  electronApp,
  window,
}) => {
  if (process.platform === 'darwin') {
    await expect
      .poll(() =>
        electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label)),
      )
      .toEqual(['Raml KQL', 'File', 'Edit', 'Selection', 'View', 'Help', 'Window']);
    return;
  }
  const menubar = window.getByRole('menubar', { name: 'Application menu' });
  await menubar.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: /Command Palette/ }).click();
  await expect(window.getByRole('combobox')).toHaveValue('>');
});
