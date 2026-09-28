import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

import type { TokenPersistence } from '../../shared/auth/models';
import { writeTextFileAtomic } from '../config/jsonc';

/** The part of Electron's `safeStorage` we use (injected for tests). */
export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only: which keyring backend Chromium picked. */
  getSelectedStorageBackend?: () => string;
}

/**
 * Decide where MSAL may keep sign-ins (spec 02, "MSAL setup"):
 * - the user opted into session-only → memory only;
 * - OS encryption available → encrypted on disk (Keychain / DPAPI / libsecret or KWallet);
 * - otherwise (Linux without a keyring) → unavailable. We never fall back to plaintext.
 */
export function resolveTokenPersistence(
  storage: SecretStorage,
  platform: NodeJS.Platform,
  sessionOnly: boolean,
): TokenPersistence {
  if (sessionOnly) return 'sessionOnly';
  if (!storage.isEncryptionAvailable()) return 'unavailable';
  if (platform === 'linux') {
    const backend = storage.getSelectedStorageBackend?.() ?? 'unknown';
    // `basic_text` means Chromium would store the key in plaintext: treat as unavailable.
    if (backend === 'basic_text' || backend === 'unknown') return 'unavailable';
  }
  return 'encrypted';
}

/**
 * MSAL cache plugin that keeps the serialized token cache encrypted with the OS key store
 * (Electron `safeStorage`). The file lives in the app's userData folder, never in the
 * shareable config dir. An unreadable file (e.g. OS key changed) is discarded, so the user
 * simply signs in again.
 */
export class EncryptedFileCachePlugin implements ICachePlugin {
  constructor(
    private readonly file: string,
    private readonly storage: SecretStorage,
  ) {}

  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    let encrypted: Buffer;
    try {
      encrypted = Buffer.from(await readFile(this.file, 'utf8'), 'base64');
    } catch {
      return; // no cache yet
    }
    try {
      context.tokenCache.deserialize(this.storage.decryptString(encrypted));
    } catch {
      await rm(this.file, { force: true });
    }
  }

  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (!context.cacheHasChanged) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    const encrypted = this.storage.encryptString(context.tokenCache.serialize());
    // Ciphertext as base64 text, readable only by the current user.
    await writeTextFileAtomic(this.file, encrypted.toString('base64'), 0o600);
  }
}
