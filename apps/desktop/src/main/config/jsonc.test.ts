import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  lineOf,
  MAX_CONFIG_FILE_BYTES,
  parseJsonc,
  propertyLine,
  readTextFile,
  writeTextFileAtomic,
} from './jsonc';

describe('JSONC helpers', () => {
  it('lineOf counts 1-based lines', () => {
    expect(lineOf('a\nb\nc', 0)).toBe(1);
    expect(lineOf('a\nb\nc', 2)).toBe(2);
    expect(lineOf('a\nb\nc', 4)).toBe(3);
  });

  it('accepts comments and trailing commas', () => {
    const { tree, problems } = parseJsonc('{\n  // note\n  "a": 1,\n}\n', 'x.jsonc');
    expect(problems).toEqual([]);
    expect(tree?.type).toBe('object');
  });

  it('reports syntax errors with line numbers', () => {
    const { problems } = parseJsonc('{\n  "a": 1\n  "b": 2\n}', 'settings.jsonc');
    expect(problems[0]).toMatchObject({ file: 'settings.jsonc', line: 3 });
  });

  it('finds the line of a property', () => {
    const text = '{\n  "a": 1,\n\n  "b": true\n}';
    expect(propertyLine(text, parseJsonc(text, 'x').tree, 'b')).toBe(4);
    expect(propertyLine(text, parseJsonc(text, 'x').tree, 'missing')).toBe(0);
  });
});

describe('file IO', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('readTextFile returns undefined for missing files and strips a BOM', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-jsonc-'));
    expect(await readTextFile(path.join(dir, 'nope.jsonc'))).toBeUndefined();
    writeFileSync(path.join(dir, 'bom.jsonc'), '\uFEFF{}');
    expect(await readTextFile(path.join(dir, 'bom.jsonc'))).toBe('{}');
  });

  it('readTextFile refuses oversized files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-jsonc-'));
    const file = path.join(dir, 'big.jsonc');
    writeFileSync(file, 'x'.repeat(MAX_CONFIG_FILE_BYTES + 1));
    await expect(readTextFile(file)).rejects.toThrow(/larger than/);
  });

  it('writeTextFileAtomic replaces the file without leaving temp files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-jsonc-'));
    const file = path.join(dir, 'settings.jsonc');
    writeFileSync(file, 'old');
    await writeTextFileAtomic(file, 'new');
    expect(readFileSync(file, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['settings.jsonc']);
  });

  it.skipIf(process.platform === 'win32')(
    'writeTextFileAtomic keeps symlinks (dotfiles repos)',
    async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'rk-jsonc-'));
      const target = path.join(dir, 'repo-settings.jsonc');
      const link = path.join(dir, 'settings.jsonc');
      writeFileSync(target, 'old');
      symlinkSync(target, link);
      await writeTextFileAtomic(link, 'new');
      expect(readlinkSync(link)).toBe(target);
      expect(readFileSync(target, 'utf8')).toBe('new');
    },
  );
});
