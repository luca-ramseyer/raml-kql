import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { watchDirectory } from './config-watcher';

describe('watchDirectory', () => {
  it('reports changed files after the debounce', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-watch-'));
    try {
      const seen = new Promise<string | undefined>((resolve) => {
        const watcher = watchDirectory(
          dir,
          (file) => {
            watcher.dispose();
            resolve(file);
          },
          20,
        );
      });
      // Give the watcher a moment to attach before writing.
      await new Promise((resolve) => setTimeout(resolve, 50));
      writeFileSync(path.join(dir, 'settings.jsonc'), '{}');
      // Platforms differ in which name they report (or none), so only assert it fired.
      await expect(seen).resolves.toSatisfy(
        (file) => file === undefined || typeof file === 'string',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is harmless for a missing directory', () => {
    const watcher = watchDirectory(path.join(tmpdir(), 'rk-does-not-exist-xyz'), () => undefined);
    expect(() => {
      watcher.dispose();
    }).not.toThrow();
  });
});
