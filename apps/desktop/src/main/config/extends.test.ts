import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadExtendedLayers } from './extends';

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe('loadExtendedLayers (spec 09 "extends")', () => {
  it('loads relative files in order, depth first, without their "extends" key', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-extends-'));
    mkdirSync(path.join(dir, 'team'));
    writeFileSync(path.join(dir, 'team', 'base.jsonc'), '{ "a": 0, "b": 0 }');
    writeFileSync(
      path.join(dir, 'team', 'settings.jsonc'),
      '{ "extends": ["./base.jsonc"], /* team */ "a": 1 }',
    );
    const { layers, problems } = await loadExtendedLayers(path.join(dir, 'settings.jsonc'), {
      extends: ['./team/settings.jsonc'],
    });
    expect(problems).toEqual([]);
    expect(layers.map((l) => l.value)).toEqual([{ a: 0, b: 0 }, { a: 1 }]);
  });

  it('refuses remote URLs, missing files and loops', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-extends-'));
    writeFileSync(path.join(dir, 'a.jsonc'), '{ "extends": ["./b.jsonc"] }');
    writeFileSync(path.join(dir, 'b.jsonc'), '{ "extends": ["./a.jsonc"] }');
    const { layers, problems } = await loadExtendedLayers(path.join(dir, 'settings.jsonc'), {
      extends: ['https://example.com/team.jsonc', './missing.jsonc', './a.jsonc'],
    });
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringContaining('Remote "extends" is not allowed') as unknown,
      expect.stringContaining('not found') as unknown,
      expect.stringContaining('loop') as unknown,
    ]);
    expect(layers.length).toBeLessThanOrEqual(2);
  });

  it('does nothing without "extends"', async () => {
    expect(await loadExtendedLayers('/x/settings.jsonc', { a: 1 })).toEqual({
      layers: [],
      problems: [],
    });
  });
});
