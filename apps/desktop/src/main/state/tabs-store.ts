import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { TabsStateSchema, type TabsState } from '../../shared/query/tabs';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

/**
 * `<config>/state/tabs.json` (spec 05): tabs restored on start, including unsaved query text.
 * Machine-local (the config folder's `.gitignore` excludes `state/`). Never result data.
 */
export class TabsStore {
  private latest: TabsState | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** The stored tabs, or undefined when missing or invalid (first run). */
  async read(): Promise<TabsState | undefined> {
    try {
      const text = await readTextFile(this.filePath);
      if (text === undefined) return undefined;
      const parsed = TabsStateSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** Save (serialized, so a slow write can't overwrite a newer one). */
  write(state: TabsState): Promise<void> {
    this.latest = state;
    const run = this.writing.then(async () => {
      if (this.latest !== state) return; // a newer state is queued
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeTextFileAtomic(this.filePath, `${JSON.stringify(state)}\n`, 0o600);
    });
    this.writing = run.catch(() => undefined);
    return run;
  }
}
