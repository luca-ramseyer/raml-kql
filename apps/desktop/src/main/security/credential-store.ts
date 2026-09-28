import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AppError } from '../../shared/errors';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

/**
 * Secrets for pack sources (spec 09: "no secrets in the config dir"). Tokens are encrypted
 * with the OS keychain (Electron `safeStorage`) and kept in the machine-local user data
 * folder; `sources.jsonc` only holds the reference (`src-…`).
 */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const FileSchema = z.record(z.string().regex(/^src-[0-9a-f]{8,32}$/), z.string().max(20_000));

export class CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  private async load(): Promise<Record<string, string>> {
    try {
      const text = await readTextFile(this.file);
      const parsed = FileSchema.safeParse(text === undefined ? {} : JSON.parse(text));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Store a token; returns its reference. */
  store(token: string): Promise<string> {
    if (!this.cipher.isEncryptionAvailable()) {
      return Promise.reject(
        new AppError({
          code: 'AUTH_UNAVAILABLE',
          message:
            'Tokens need the OS keychain, which is not available. Use a public repository or import the pack from a file.',
          retryable: false,
          source: 'main',
        }),
      );
    }
    return this.serialized(async () => {
      const ref = `src-${randomBytes(8).toString('hex')}`;
      const all = await this.load();
      all[ref] = this.cipher.encryptString(token).toString('base64');
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeTextFileAtomic(this.file, JSON.stringify(all), 0o600);
      return ref;
    });
  }

  async get(ref: string): Promise<string | undefined> {
    const encrypted = (await this.load())[ref];
    if (encrypted === undefined || !this.cipher.isEncryptionAvailable()) return undefined;
    try {
      return this.cipher.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return undefined;
    }
  }

  delete(ref: string): Promise<void> {
    return this.serialized(async () => {
      const { [ref]: removed, ...rest } = await this.load();
      if (removed === undefined) return;
      await writeTextFileAtomic(this.file, JSON.stringify(rest), 0o600);
    });
  }
}
