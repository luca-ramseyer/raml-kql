import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsoncAccountsConfig } from './accounts-config';

describe('JsoncAccountsConfig', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('creates accounts.jsonc with an explanatory comment and keeps user comments', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-accounts-'));
    const file = path.join(dir, 'accounts.jsonc');
    const config = new JsoncAccountsConfig(file);
    expect(await config.read()).toEqual([]);
    await config.write([{ id: 'a', provider: 'builtin', username: 'u@contoso.example' }]);
    expect(readFileSync(file, 'utf8')).toContain('Tokens are never stored here');

    writeFileSync(file, readFileSync(file, 'utf8').replace('{', '{\n  // mine'));
    await config.write([{ id: 'a', provider: 'builtin', label: 'Work' }]);
    expect(readFileSync(file, 'utf8')).toContain('// mine');
    expect(await config.read()).toEqual([{ id: 'a', provider: 'builtin', label: 'Work' }]);
  });

  it('skips invalid entries and survives broken files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-accounts-'));
    const file = path.join(dir, 'accounts.jsonc');
    writeFileSync(
      file,
      '{ "accounts": [ { "id": "ok", "provider": "azureCli" }, { "id": 5 }, { "id": "x", "provider": "nope" } ] }',
    );
    expect(await new JsoncAccountsConfig(file).read()).toEqual([
      { id: 'ok', provider: 'azureCli' },
    ]);
    writeFileSync(file, '{ "accounts": [');
    expect(await new JsoncAccountsConfig(file).read()).toEqual([]);
  });
});
