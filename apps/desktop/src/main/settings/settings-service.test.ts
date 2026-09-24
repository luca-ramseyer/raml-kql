import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../shared/errors';

import { evaluateSettingsText, SettingsService } from './settings-service';

describe('evaluateSettingsText', () => {
  it('treats a missing or empty file as no user settings', () => {
    expect(evaluateSettingsText(undefined, {})).toEqual({ values: {}, problems: [] });
    expect(evaluateSettingsText('  \n', {})).toEqual({ values: {}, problems: [] });
  });

  it('returns valid registered values and ignores unknown keys', () => {
    const text = `{
      // comments are fine
      "workbench.colorTheme": "Default Light Modern",
      "window.autoDetectColorScheme": false,
      "some.extension.setting": 42,
    }`;
    expect(evaluateSettingsText(text, {})).toEqual({
      values: {
        'workbench.colorTheme': 'Default Light Modern',
        'window.autoDetectColorScheme': false,
      },
      problems: [],
    });
  });

  it('keeps the last valid values when the file has a syntax error', () => {
    const previous = { 'workbench.colorTheme': 'Default Light Modern' };
    const result = evaluateSettingsText('{\n  "workbench.colorTheme": \n}', previous);
    expect(result.values).toEqual(previous);
    expect(result.problems[0]).toMatchObject({ file: 'settings.jsonc', line: 3 });
  });

  it('reports an invalid value with its line and keeps the previous value for that key', () => {
    const previous = { 'window.autoDetectColorScheme': true };
    const text =
      '{\n  "workbench.colorTheme": "Default Light Modern",\n  "window.autoDetectColorScheme": "yes"\n}';
    const result = evaluateSettingsText(text, previous);
    expect(result.values).toEqual({
      'workbench.colorTheme': 'Default Light Modern',
      'window.autoDetectColorScheme': true,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ line: 3 });
    expect(result.problems[0]?.message).toContain('window.autoDetectColorScheme');
  });

  it('rejects a file that is not an object', () => {
    const result = evaluateSettingsText('[1, 2]', { 'workbench.statusBar.visible': false });
    expect(result.values).toEqual({ 'workbench.statusBar.visible': false });
    expect(result.problems[0]?.message).toMatch(/must contain a JSON object/);
  });
});

describe('SettingsService', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-settings-'));
    file = path.join(dir, 'settings.jsonc');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates settings.jsonc on first write', async () => {
    const service = new SettingsService(file);
    const snapshot = await service.update({
      action: 'set',
      key: 'workbench.colorTheme',
      value: 'Default Light Modern',
    });
    expect(snapshot.values).toEqual({ 'workbench.colorTheme': 'Default Light Modern' });
    expect(readFileSync(file, 'utf8')).toContain('"workbench.colorTheme": "Default Light Modern"');
  });

  it('preserves the user’s comments and formatting when editing', async () => {
    writeFileSync(
      file,
      '{\n  // my favourite\n  "workbench.colorTheme": "Default Light Modern",\n  /* keep */ "window.autoDetectColorScheme": false,\n}\n',
    );
    const service = new SettingsService(file);
    await service.reload();
    await service.update({ action: 'set', key: 'workbench.statusBar.visible', value: false });
    await service.update({ action: 'reset', key: 'workbench.colorTheme' });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('// my favourite');
    expect(text).toContain('/* keep */');
    expect(text).toContain('"workbench.statusBar.visible": false');
    expect(text).not.toContain('workbench.colorTheme');
    expect(service.current.values).toEqual({
      'window.autoDetectColorScheme': false,
      'workbench.statusBar.visible': false,
    });
  });

  it('refuses to edit a file with syntax errors', async () => {
    writeFileSync(file, '{ "workbench.colorTheme": }');
    const service = new SettingsService(file);
    await expect(
      service.update({ action: 'set', key: 'workbench.statusBar.visible', value: false }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(readFileSync(file, 'utf8')).toBe('{ "workbench.colorTheme": }');
  });

  it('rejects unknown settings and invalid values without writing', async () => {
    const service = new SettingsService(file);
    await expect(service.update({ action: 'set', key: 'nope', value: 1 })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(
      service.update({ action: 'set', key: 'workbench.statusBar.visible', value: 'no' }),
    ).rejects.toMatchObject({ code: 'SETTING_INVALID_VALUE' });
    await expect(
      service.update({ action: 'set', key: 'workbench.commandPalette.history', value: 1000 }),
    ).rejects.toMatchObject({ code: 'SETTING_INVALID_VALUE' });
    expect(() => readFileSync(file)).toThrow();
  });

  it('serialises concurrent writes so none is lost', async () => {
    const service = new SettingsService(file);
    await Promise.all([
      service.update({ action: 'set', key: 'workbench.statusBar.visible', value: false }),
      service.update({ action: 'set', key: 'workbench.colorTheme', value: 'Default Light Modern' }),
      service.update({ action: 'set', key: 'workbench.commandPalette.history', value: 10 }),
    ]);
    expect(service.current.values).toEqual({
      'workbench.statusBar.visible': false,
      'workbench.colorTheme': 'Default Light Modern',
      'workbench.commandPalette.history': 10,
    });
  });

  it('notifies listeners only when the effective settings change', async () => {
    writeFileSync(file, '{ "workbench.statusBar.visible": false }');
    const service = new SettingsService(file);
    const listener = vi.fn();
    service.onDidChange(listener);
    await service.reload();
    await service.reload();
    expect(listener).toHaveBeenCalledOnce();
    writeFileSync(file, '{ "workbench.statusBar.visible": true }');
    await service.reload();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
