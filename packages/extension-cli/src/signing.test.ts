import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SIGNATURE_FILE } from '@raml-kql/pack-schema/extension-signature';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './index';

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('keygen, sign and verify', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function workspace() {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-sign-'));
    dirs.push(dir);
    const pack = path.join(dir, 'demo.rkqlx');
    writeFileSync(
      pack,
      zipSync({ 'package.json': bytes('{"name":"demo"}'), 'dist/extension.js': bytes('1') }),
    );
    return { dir, pack, keys: path.join(dir, 'keys') };
  }

  it('creates a key pair, refuses to overwrite it, and keeps the private key private', () => {
    const { keys } = workspace();
    const created = run(['keygen', '--out', keys]);
    expect(created.code).toBe(0);
    expect(created.out).toMatch(/Key id: [0-9a-f]{16}/);
    expect(readFileSync(path.join(keys, 'raml-kql-signing.pub'), 'utf8')).toContain('PUBLIC KEY');
    if (process.platform !== 'win32') {
      expect(statSync(path.join(keys, 'raml-kql-signing.key')).mode & 0o777).toBe(0o600);
    }
    expect(created.out).not.toContain('PRIVATE KEY');
    expect(run(['keygen', '--out', keys]).code).toBe(1);
  });

  it('signs a package so that it verifies, and detects tampering', () => {
    const { pack, keys } = workspace();
    run(['keygen', '--out', keys]);
    const key = path.join(keys, 'raml-kql-signing.key');
    const pub = path.join(keys, 'raml-kql-signing.pub');

    expect(run(['verify', pack, '--key', pub]).code).toBe(1); // not signed yet
    expect(run(['sign', pack, '--key', key]).code).toBe(0);
    expect(run(['verify', pack, '--key', pub])).toMatchObject({ code: 0 });
    expect(Object.keys(unzipSync(new Uint8Array(readFileSync(pack))))).toContain(SIGNATURE_FILE);

    // Signing again replaces the signature rather than stacking them.
    expect(run(['sign', pack, '--key', key]).code).toBe(0);
    expect(run(['verify', pack, '--key', pub]).code).toBe(0);

    const entries: Record<string, Uint8Array> = unzipSync(new Uint8Array(readFileSync(pack)));
    entries['dist/extension.js'] = bytes('steal()');
    writeFileSync(pack, zipSync(entries));
    const tampered = run(['verify', pack, '--key', pub]);
    expect(tampered.code).toBe(1);
    expect(tampered.err).toContain('Invalid signature');
  });

  it('takes the key from RAML_KQL_SIGNING_KEY, as CI does', () => {
    const { pack, keys, dir } = workspace();
    run(['keygen', '--out', keys]);
    const pem = readFileSync(path.join(keys, 'raml-kql-signing.key'), 'utf8');
    const signed = path.join(dir, 'signed.rkqlx');
    process.env['RAML_KQL_SIGNING_KEY'] = pem;
    try {
      expect(run(['sign', pack, '-o', signed]).code).toBe(0);
    } finally {
      delete process.env['RAML_KQL_SIGNING_KEY'];
    }
    expect(run(['verify', signed, '--key', path.join(keys, 'raml-kql-signing.pub')]).code).toBe(0);
    // The original is untouched when --out is given.
    expect(Object.keys(unzipSync(new Uint8Array(readFileSync(pack))))).not.toContain(
      SIGNATURE_FILE,
    );
  });

  it('explains what is missing', () => {
    const { pack } = workspace();
    expect(run(['sign', pack]).code).toBe(2);
    expect(run(['sign']).code).toBe(2);
    expect(run(['verify', pack]).code).toBe(2);
    expect(run(['keygen']).code).toBe(2);
  });
});
