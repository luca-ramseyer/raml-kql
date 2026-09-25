import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AppError } from '../../shared/errors';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';
import type { SecretCipher } from '../security/credential-store';

import type { KeyValueStore, SecretStore } from './extension-manager';

/**
 * Per-extension secrets (spec 07, `ramlKql.secrets`): encrypted with the OS keychain
 * (`safeStorage`) in the machine-local user data folder, never in the config folder.
 */
export class ExtensionSecrets implements SecretStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  private async load(): Promise<Record<string, Record<string, string>>> {
    try {
      const text = await readTextFile(this.file);
      const parsed = z
        .record(z.string(), z.record(z.string(), z.string()))
        .safeParse(text === undefined ? {} : JSON.parse(text));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private update(work: (all: Record<string, Record<string, string>>) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      work(all);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeTextFileAtomic(this.file, JSON.stringify(all), 0o600);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async get(extensionId: string, key: string): Promise<string | undefined> {
    const encrypted = (await this.load())[extensionId]?.[key];
    if (encrypted === undefined || !this.cipher.isEncryptionAvailable()) return undefined;
    try {
      return this.cipher.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return undefined;
    }
  }

  set(extensionId: string, key: string, value: string): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) {
      return Promise.reject(
        new AppError({
          code: 'AUTH_UNAVAILABLE',
          message: 'Secrets need the OS keychain, which is not available.',
          retryable: false,
          source: 'main',
        }),
      );
    }
    return this.update((all) => {
      all[extensionId] = {
        ...all[extensionId],
        [key]: this.cipher.encryptString(value).toString('base64'),
      };
    });
  }

  delete(extensionId: string, key?: string): Promise<void> {
    return this.update((all) => {
      if (key === undefined) Reflect.deleteProperty(all, extensionId);
      else if (all[extensionId] !== undefined) Reflect.deleteProperty(all[extensionId], key);
    });
  }
}

const MAX_STORAGE_BYTES = 5 * 1024 * 1024;

/** `ramlKql.storage`: one JSON file per extension in `state/extension-storage/`, 5 MB each. */
export class ExtensionStorage implements KeyValueStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private file(extensionId: string): string {
    return path.join(this.dir, `${extensionId}.json`);
  }

  private async load(extensionId: string): Promise<Record<string, unknown>> {
    try {
      const text = await readTextFile(this.file(extensionId));
      const value = text === undefined ? {} : (JSON.parse(text) as unknown);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  async get(extensionId: string, key: string): Promise<unknown> {
    return (await this.load(extensionId))[key];
  }

  set(extensionId: string, key: string, value: unknown): Promise<void> {
    const run = (this.queues.get(extensionId) ?? Promise.resolve()).then(async () => {
      const all = { ...(await this.load(extensionId)), [key]: value };
      const text = JSON.stringify(all);
      if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) {
        throw new Error('Extension storage is limited to 5 MB.');
      }
      await mkdir(this.dir, { recursive: true });
      await writeTextFileAtomic(this.file(extensionId), text, 0o600);
    });
    this.queues.set(
      extensionId,
      run.catch(() => undefined),
    );
    return run;
  }

  async clear(extensionId: string): Promise<void> {
    await rm(this.file(extensionId), { force: true });
  }
}
