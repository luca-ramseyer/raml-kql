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
});
