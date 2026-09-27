import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CrashRecordSchema, type CrashRecord } from '../../shared/crash/models';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

/**
 * Crash records in `state/crashes/` (spec 10): one sanitized JSON file each, the newest 50
 * kept. A session marker tells the next start whether the app ended normally.
 */
const KEEP = 50;
const MARKER = '.session';
const SEEN = '.seen';

export class CrashStore {
  constructor(private readonly dir: string) {}

  async write(record: Omit<CrashRecord, 'id'>): Promise<CrashRecord> {
    const full: CrashRecord = { ...record, id: randomBytes(6).toString('hex') };
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(this.dir, `${full.ts.replace(/[:.]/g, '-')}-${full.id}.json`),
      JSON.stringify(full),
      { mode: 0o600 },
    );
    await this.prune();
    return full;
  }

  async list(): Promise<CrashRecord[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return [];
    }
    const records: CrashRecord[] = [];
    for (const file of files) {
      try {
        const parsed = CrashRecordSchema.safeParse(
          JSON.parse(await readFile(path.join(this.dir, file), 'utf8')),
        );
        if (parsed.success) records.push(parsed.data);
      } catch {
        // A damaged file is skipped.
      }
    }
    return records;
  }

  private async prune(): Promise<void> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json')).sort();
    for (const file of files.slice(0, Math.max(0, files.length - KEEP))) {
      await rm(path.join(this.dir, file), { force: true });
    }
  }

  /** When the user last dealt with crash reports (records after this are new). */
  async lastSeen(): Promise<string> {
    return (await readTextFile(path.join(this.dir, SEEN)))?.trim() ?? '';
  }

  async markSeen(at: string): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeTextFileAtomic(path.join(this.dir, SEEN), at, 0o600);
  }

  /** Start a session; true when the previous one didn't end normally. */
  async startSession(): Promise<boolean> {
    const marker = path.join(this.dir, MARKER);
    const unclean = (await readTextFile(marker)) !== undefined;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(marker, String(process.pid), { mode: 0o600 });
    return unclean;
  }

  /** Synchronous: `will-quit` can't wait for promises. */
  endSession(): void {
    rmSync(path.join(this.dir, MARKER), { force: true });
  }
}
