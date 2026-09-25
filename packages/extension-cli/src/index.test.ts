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
});
