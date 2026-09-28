import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local audit log (spec 04, "Audit log"): append-only JSONL in `<config>/audit/`, one file per
 * month, hash-chained (`prev` = SHA-256 of the previous line) so edits and deletions inside
 * the kept history are evident. Never contains tokens or result values.
 */

export type AuditEvent =
  | {
      kind: 'query';
      runId: string;
      account: string;
      via: string;
      tenantId: string;
      workspaceId: string;
      workspaceResourceId: string;
      query: string;
      timespan?: string | undefined;
      state: string;
      rows: number;
      durationMs: number;
      attempt: number;
    }
  | { kind: 'auth'; event: 'signIn' | 'signOut'; account: string }
  | {
      /** Extension lifecycle and permission decisions (spec 07). */
      kind: 'extension';
      event:
        'install' | 'update' | 'uninstall' | 'enable' | 'disable' | 'grant' | 'deny' | 'revoke';
      extension: string;
      version?: string | undefined;
      permission?: string | undefined;
      scope?: string | undefined;
      hosts?: string[] | undefined;
    };

export interface AuditLogOptions {
  dir: string;
  appVersion: string;
  enabled: () => boolean;
  includeQueryText: () => boolean;
  retentionMonths: () => number;
  now?: () => Date;
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  files: number;
  /** First problem found. */
  problem?: { file: string; line: number; reason: string };
}

const GENESIS = `sha256:${'0'.repeat(64)}`;
const FILE_PATTERN = /^audit-(\d{4})-(\d{2})\.jsonl$/;

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export class AuditLog {
  private state: { seq: number; prev: string } | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly options: AuditLogOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Append one event. Appends are serialized, so the chain never forks. */
  append(event: AuditEvent): Promise<void> {
    if (!this.options.enabled()) return Promise.resolve();
    const run = this.queue.then(() => this.write(event));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Delete months older than `audit.retentionMonths`. */
  async prune(): Promise<void> {
    const keep = Math.max(1, this.options.retentionMonths());
    const now = this.now();
    const cutoff = now.getUTCFullYear() * 12 + now.getUTCMonth() - (keep - 1);
    for (const file of await this.files()) {
      const match = FILE_PATTERN.exec(file);
      if (match === null) continue;
      const month = Number(match[1]) * 12 + Number(match[2]) - 1;
      if (month < cutoff) await rm(path.join(this.options.dir, file), { force: true });
    }
  }

  /**
   * Check every kept line: valid JSON, `seq` increasing by one and `prev` matching the hash of
   * the line before. The oldest kept line is the anchor (older months may have been pruned).
   */
  async verify(): Promise<AuditVerification> {
    const files = await this.files();
    let previous: { text: string; seq: number } | undefined;
    let entries = 0;
    for (const file of files) {
      const lines = (await readFile(path.join(this.options.dir, file), 'utf8'))
        .split('\n')
        .filter((line) => line !== '');
      for (const [index, text] of lines.entries()) {
        const fail = (reason: string): AuditVerification => ({
          ok: false,
          entries,
          files: files.length,
          problem: { file, line: index + 1, reason },
        });
        let entry: { seq?: unknown; prev?: unknown };
        try {
          entry = JSON.parse(text) as { seq?: unknown; prev?: unknown };
        } catch {
          return fail('not valid JSON');
        }
        if (typeof entry.seq !== 'number' || typeof entry.prev !== 'string') {
          return fail('missing seq or prev');
        }
        if (previous !== undefined) {
          if (entry.prev !== sha256(previous.text)) return fail('hash chain broken');
          if (entry.seq !== previous.seq + 1) return fail('sequence gap');
        }
        previous = { text, seq: entry.seq };
        entries += 1;
      }
    }
    return { ok: true, entries, files: files.length };
  }

  // --- Internals ----------------------------------------------------------------------------

  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.options.dir)).filter((f) => FILE_PATTERN.test(f)).sort();
    } catch {
      return [];
    }
  }

  private async load(): Promise<{ seq: number; prev: string }> {
    const files = await this.files();
    for (const file of files.reverse()) {
      const lines = (await readFile(path.join(this.options.dir, file), 'utf8'))
        .split('\n')
        .filter((line) => line !== '');
      const last = lines.at(-1);
      if (last === undefined) continue;
      try {
        const { seq } = JSON.parse(last) as { seq: number };
        return { seq, prev: sha256(last) };
      } catch {
        // A damaged last line: chain onto it anyway, so verification points at the damage.
        return { seq: lines.length, prev: sha256(last) };
      }
    }
    return { seq: 0, prev: GENESIS };
  }

  private async write(event: AuditEvent): Promise<void> {
    this.state ??= await this.load();
    const ts = this.now();
    const body =
      event.kind === 'query'
        ? {
            ...event,
            queryHash: sha256(event.query),
            query: this.options.includeQueryText() ? event.query : undefined,
          }
        : event;
    const entry = {
      ts: ts.toISOString(),
      seq: this.state.seq + 1,
      ...body,
      appVersion: this.options.appVersion,
      prev: this.state.prev,
    };
    const line = JSON.stringify(entry);
    const month = `${String(ts.getUTCFullYear())}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}`;
    await mkdir(this.options.dir, { recursive: true, mode: 0o700 });
    await appendFile(path.join(this.options.dir, `audit-${month}.jsonl`), `${line}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    this.state = { seq: entry.seq, prev: sha256(line) };
  }
}
