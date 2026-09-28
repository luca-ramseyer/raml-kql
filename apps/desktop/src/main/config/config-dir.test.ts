import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { configPaths, ensureConfigDir, resolveConfigDir } from './config-dir';

describe('resolveConfigDir (spec 09 resolution order)', () => {
  const base = { env: {}, platform: 'darwin' as const, homeDir: '/Users/analyst' };

  it('defaults to ~/.raml-kql on macOS', () => {
    expect(resolveConfigDir({ ...base, argv: [] })).toBe('/Users/analyst/.raml-kql');
  });

  it('prefers --config-dir <path> over everything', () => {
    expect(
      resolveConfigDir({
        ...base,
        argv: ['--config-dir', '/tmp/cfg'],
        env: { RAML_KQL_CONFIG_DIR: '/tmp/env' },
      }),
    ).toBe('/tmp/cfg');
  });

  it('accepts --config-dir=<path>', () => {
    expect(resolveConfigDir({ ...base, argv: ['--config-dir=/tmp/cfg2'] })).toBe('/tmp/cfg2');
  });

  it('ignores a --config-dir flag without a value', () => {
    expect(resolveConfigDir({ ...base, argv: ['--config-dir', '--demo'] })).toBe(
      '/Users/analyst/.raml-kql',
    );
  });

  it('uses RAML_KQL_CONFIG_DIR next', () => {
    expect(resolveConfigDir({ ...base, argv: [], env: { RAML_KQL_CONFIG_DIR: '/srv/rk' } })).toBe(
      '/srv/rk',
    );
  });

  it('uses $XDG_CONFIG_HOME/raml-kql on Linux when set', () => {
    expect(
      resolveConfigDir({
        argv: [],
        env: { XDG_CONFIG_HOME: '/home/a/.config' },
        platform: 'linux',
        homeDir: '/home/a',
      }),
    ).toBe('/home/a/.config/raml-kql');
    expect(resolveConfigDir({ argv: [], env: {}, platform: 'linux', homeDir: '/home/a' })).toBe(
      '/home/a/.raml-kql',
    );
  });

  it('uses %USERPROFILE%\\.raml-kql on Windows', () => {
    expect(
      resolveConfigDir({
        argv: [],
        env: { USERPROFILE: 'C:\\Users\\analyst' },
        platform: 'win32',
        homeDir: 'C:\\Users\\other',
      }),
    ).toBe('C:\\Users\\analyst\\.raml-kql');
  });
});

describe('ensureConfigDir', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the folders plus a .gitignore and README on first run', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-config-'));
    const paths = configPaths(path.join(dir, 'cfg'));
    await ensureConfigDir(paths);
    const gitignore = readFileSync(path.join(paths.root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('state/');
    expect(gitignore).toContain('audit/');
    expect(readFileSync(path.join(paths.root, 'README.md'), 'utf8')).toContain('No tokens');
  });

  it('never overwrites existing files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-config-'));
    const paths = configPaths(dir);
    writeFileSync(path.join(dir, '.gitignore'), 'mine\n');
    await ensureConfigDir(paths);
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('mine\n');
  });
});
