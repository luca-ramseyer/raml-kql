import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadUserThemes, UserThemesService } from './user-themes';

describe('loadUserThemes', () => {
  let root: string;
  let themes: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'rk-themes-'));
    themes = path.join(root, 'themes');
    mkdirSync(themes);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns nothing when the folder is missing', async () => {
    expect(await loadUserThemes(path.join(root, 'missing'))).toEqual({ themes: [], problems: [] });
  });

  it('loads VS Code theme files, resolving include and sanitising colours', async () => {
    writeFileSync(
      path.join(themes, 'base.json'),
      '{ "type": "light", "colors": { "editor.background": "#ffffff", "foreground": "#111111" } }',
    );
    writeFileSync(
      path.join(themes, 'contoso.jsonc'),
      `{
        // A theme a colleague shared
        "name": "Contoso Light",
        "include": "./base.json",
        "colors": {
          "foreground": "#222222",
          "bad key!": "#000000",
          "editor.foreground": "red",
          "activityBar.background": "#FF000080",
        },
        "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#008000" } }],
      }`,
    );
    const snapshot = await loadUserThemes(themes);
    const contoso = snapshot.themes.find((t) => t.label === 'Contoso Light');
    expect(contoso).toEqual({
      id: 'user:contoso.jsonc',
      label: 'Contoso Light',
      uiTheme: 'vs',
      colors: {
        'editor.background': '#ffffff',
        foreground: '#222222',
        'activityBar.background': '#FF000080',
      },
      tokenColors: [{ scope: 'comment', settings: { foreground: '#008000' } }],
    });
    // The included base file is itself listed, named after the file.
    expect(snapshot.themes.map((t) => t.label)).toContain('base');
  });

  it('refuses includes that leave the themes folder', async () => {
    writeFileSync(path.join(root, 'outside.json'), '{ "colors": {} }');
    writeFileSync(path.join(themes, 'evil.json'), '{ "include": "../outside.json" }');
    const snapshot = await loadUserThemes(themes);
    expect(snapshot.themes).toEqual([]);
    expect(snapshot.problems[0]).toMatchObject({ file: 'themes/evil.json' });
    expect(snapshot.problems[0]?.message).toMatch(/inside the themes folder/);
  });

  it('stops include cycles', async () => {
    writeFileSync(path.join(themes, 'a.json'), '{ "include": "./b.json" }');
    writeFileSync(path.join(themes, 'b.json'), '{ "include": "./a.json" }');
    const snapshot = await loadUserThemes(themes);
    expect(snapshot.themes).toEqual([]);
    expect(snapshot.problems).toHaveLength(2);
  });

  it('reports syntax errors and duplicate names', async () => {
    writeFileSync(path.join(themes, 'broken.json'), '{ "colors": ');
    writeFileSync(path.join(themes, 'one.json'), '{ "name": "Same" }');
    writeFileSync(path.join(themes, 'two.json'), '{ "name": "Same" }');
    const snapshot = await loadUserThemes(themes);
    expect(snapshot.themes.map((t) => t.label)).toEqual(['Same']);
    expect(snapshot.problems.map((p) => p.file).sort()).toEqual([
      'themes/broken.json',
      'themes/two.json',
    ]);
  });

  it('maps VS Code theme types and defaults to dark', async () => {
    writeFileSync(path.join(themes, 'hc.json'), '{ "name": "HC", "type": "hc" }');
    writeFileSync(path.join(themes, 'none.json'), '{ "name": "None" }');
    const { themes: loaded } = await loadUserThemes(themes);
    expect(loaded.find((t) => t.label === 'HC')?.uiTheme).toBe('hc-black');
    expect(loaded.find((t) => t.label === 'None')?.uiTheme).toBe('vs-dark');
  });

  it('UserThemesService notifies on change', async () => {
    const service = new UserThemesService(themes);
    let calls = 0;
    service.onDidChange(() => (calls += 1));
    writeFileSync(path.join(themes, 'x.json'), '{ "name": "X" }');
    await service.reload();
    await service.reload();
    expect(calls).toBe(1);
    expect(service.current.themes.map((t) => t.label)).toEqual(['X']);
  });
});
