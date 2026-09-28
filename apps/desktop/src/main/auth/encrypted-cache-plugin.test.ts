import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TokenCacheContext } from '@azure/msal-node';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EncryptedFileCachePlugin,
  resolveTokenPersistence,
  type SecretStorage,
} from './encrypted-cache-plugin';

/** A stand-in for safeStorage: "encrypts" by base64-encoding with a marker prefix. */
const fakeStorage = (overrides: Partial<SecretStorage> = {}): SecretStorage => ({
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
  decryptString: (data) => {
    const text = data.toString();
    if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
    return Buffer.from(text.slice(4), 'base64').toString();
  },
  ...overrides,
});

function context(initial: string, changed: boolean) {
  let state = initial;
  return {
    get cacheHasChanged() {
      return changed;
    },
    tokenCache: {
      serialize: () => state,
      deserialize: (value: string) => {
        state = value;
      },
    },
    get state() {
      return state;
    },
  } as unknown as TokenCacheContext & { state: string };
}

describe('resolveTokenPersistence', () => {
  it('honours session-only opt-in first', () => {
    expect(resolveTokenPersistence(fakeStorage(), 'darwin', true)).toBe('sessionOnly');
  });

  it('uses encrypted storage when the OS provides it', () => {
    expect(resolveTokenPersistence(fakeStorage(), 'darwin', false)).toBe('encrypted');
    expect(
      resolveTokenPersistence(
        fakeStorage({ getSelectedStorageBackend: () => 'gnome_libsecret' }),
        'linux',
        false,
      ),
    ).toBe('encrypted');
  });

  it('never falls back to plaintext on Linux without a keyring', () => {
    expect(
      resolveTokenPersistence(
        fakeStorage({ getSelectedStorageBackend: () => 'basic_text' }),
        'linux',
        false,
      ),
    ).toBe('unavailable');
    expect(
      resolveTokenPersistence(fakeStorage({ isEncryptionAvailable: () => false }), 'win32', false),
    ).toBe('unavailable');
  });
});

describe('EncryptedFileCachePlugin', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips the cache encrypted, never as plaintext, readable only by the user', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-msal-'));
    const file = path.join(dir, 'auth', 'cache.bin');
    const plugin = new EncryptedFileCachePlugin(file, fakeStorage());
    await plugin.afterCacheAccess(context('{"RefreshToken":{"secret":"r3fresh"}}', true));
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('r3fresh');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

    const reader = context('', false);
    await plugin.beforeCacheAccess(reader);
    expect(reader.state).toBe('{"RefreshToken":{"secret":"r3fresh"}}');
  });

  it('does not write when nothing changed', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-msal-'));
    const file = path.join(dir, 'cache.bin');
    await new EncryptedFileCachePlugin(file, fakeStorage()).afterCacheAccess(context('x', false));
    expect(() => statSync(file)).toThrow();
  });

  it('discards an unreadable cache so the user just signs in again', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-msal-'));
    const file = path.join(dir, 'cache.bin');
    writeFileSync(file, Buffer.from('garbage').toString('base64'));
    const reader = context('empty', false);
    await new EncryptedFileCachePlugin(file, fakeStorage()).beforeCacheAccess(reader);
    expect(reader.state).toBe('empty');
    expect(() => statSync(file)).toThrow();
  });
});
