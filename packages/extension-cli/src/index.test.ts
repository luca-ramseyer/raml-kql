import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLI_VERSION, runCli } from './index';

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('runCli', () => {
  it('prints help with no arguments', () => {
    const result = run([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Usage: raml-kql-ext');
  });

  it('prints the version', () => {
    expect(run(['--version'])).toEqual({ code: 0, out: CLI_VERSION, err: '' });
  });

  it('fails on unknown commands', () => {
    const result = run(['bogus']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown command 'bogus'");
  });

  it('validates query packs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-cli-'));
    try {
      const example = path.resolve(import.meta.dirname, '../../../examples/packs/raml.starter');
      const ok = run(['pack', 'validate', example]);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain('raml.starter 1.0.0: 11 queries');

      writeFileSync(
        path.join(dir, 'rkqlpack.yaml'),
        'schemaVersion: 1\nid: contoso.x\nname: X\nversion: 1.0.0\ndescription: X\n',
      );
      mkdirSync(path.join(dir, 'queries'));
      writeFileSync(
        path.join(dir, 'queries', 'q.kql'),
        '// ---\n// id: q\n// name: Q\n// ---\nHeartbeat',
      );
      const bad = run(['pack', 'validate', dir]);
      expect(bad.code).toBe(1);
      expect(bad.err).toContain('queries/q.kql');
      expect(bad.err).toContain('1 problem found.');

      expect(run(['pack', 'validate', path.join(dir, 'missing')]).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds, validates and packages an extension', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-ext-cli-'));
    try {
      const target = path.join(dir, 'hello-ext');
      expect(run(['init', target, '--publisher', 'contoso']).code).toBe(0);
      // Not built yet: dist/extension.js is missing.
      const unbuilt = run(['validate', target]);
      expect(unbuilt.code).toBe(1);
      expect(unbuilt.err).toContain('dist/extension.js');

      mkdirSync(path.join(target, 'dist'));
      writeFileSync(
        path.join(target, 'dist', 'extension.js'),
        "import x from 'lodash';\nexport function activate() {}",
      );
      expect(run(['validate', target]).err).toContain('bundle it into one file');

      writeFileSync(path.join(target, 'dist', 'extension.js'), 'export function activate() {}');
      expect(run(['validate', target])).toMatchObject({
        code: 0,
        out: 'contoso.hello-ext 0.1.0: no problems found.',
      });
      const out = path.join(dir, 'hello.rkqlx');
      const packaged = run(['package', target, '-o', out]);
      expect(packaged.code).toBe(0);
      // Sources and tooling are left out: package.json, README.md and the bundle.
      expect(packaged.out).toContain('Packaged 3 files');
      expect(run(['init', target, '--publisher', 'contoso']).code).toBe(1);
      expect(run(['init', path.join(dir, 'Bad Name'), '--publisher', 'contoso']).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
