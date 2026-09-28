import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { HistoryEntrySchema, type HistoryEntry } from '../../shared/query/history';
import type { QueryRunRequest, RunSnapshot } from '../../shared/query/models';
import { writeTextFileAtomic } from '../config/jsonc';

/**
 * Query history (spec 05): each finished run is appended to `state/history.jsonl`, capped at
 * `history.maxEntries` (oldest dropped). Query text and target keys only, never result data.
 */
export interface HistoryServiceOptions {
  file: string;
  maxEntries: () => number;
  tenantOf: (resourceId: string) => string | undefined;
  onChange: () => void;
}

export class HistoryService {
  private readonly pending = new Map<string, QueryRunRequest>();
  private cache: HistoryEntry[] | undefined;
  private loading: Promise<HistoryEntry[]> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: HistoryServiceOptions) {}

  /** Remember what was asked for (group, time range) until the run finishes. */
  started(runId: string, request: QueryRunRequest): void {
    this.pending.set(runId, request);
  }

  /** Engine snapshots: record a run the first time it finishes (re-runs aren't new entries). */
  observe(snapshot: RunSnapshot): void {
    if (snapshot.state === 'running' || snapshot.finishedAt === undefined) return;
    const request = this.pending.get(snapshot.runId);
    if (request === undefined) return;
    this.pending.delete(snapshot.runId);
    const counts = { succeeded: 0, partial: 0, failed: 0, timeout: 0, cancelled: 0, skipped: 0 };
    let rows = 0;
    for (const workspace of snapshot.workspaces) {
      rows += workspace.rows;
      if (workspace.state in counts) counts[workspace.state as keyof typeof counts] += 1;
    }
    const tenantIds = [
      ...new Set(
        request.resourceIds
          .map((id) => this.options.tenantOf(id.toLowerCase()))
          .filter((t): t is string => t !== undefined),
      ),
    ];
    const entry: HistoryEntry = {
      id: snapshot.runId,
      ts: snapshot.startedAt,
      query: request.query,
      targets: request.resourceIds.map((id) => id.toLowerCase()),
      tenantIds,
      ...(request.groupId === undefined ? {} : { groupId: request.groupId }),
      ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
      ...(snapshot.timespan === undefined ? {} : { timespan: snapshot.timespan }),
      ...(request.tabTitle === undefined ? {} : { tabTitle: request.tabTitle }),
      counts,
      rows,
      durationMs: Math.max(0, Date.parse(snapshot.finishedAt) - Date.parse(snapshot.startedAt)),
    };
    void this.append(entry).catch(() => undefined);
  }

  /** Entries, newest first. */
  async list(): Promise<HistoryEntry[]> {
    return (await this.load()).slice(-Math.max(1, this.options.maxEntries())).reverse();
  }

  async clear(): Promise<void> {
    await this.serialized(async () => {
      this.cache = [];
      await rm(this.options.file, { force: true });
    });
    this.options.onChange();
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One shared load: concurrent callers (a list and an append) must share one cache array. */
  private load(): Promise<HistoryEntry[]> {
    if (this.cache !== undefined) return Promise.resolve(this.cache);
    this.loading ??= this.read().then((entries) => {
      this.cache ??= entries;
      this.loading = undefined;
      return this.cache;
    });
    return this.loading;
  }

  private async read(): Promise<HistoryEntry[]> {
    let text = '';
    try {
      text = await readFile(this.options.file, 'utf8');
    } catch {
      text = '';
    }
    const entries: HistoryEntry[] = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed = HistoryEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) entries.push(parsed.data);
      } catch {
        // A damaged line (e.g. a crash mid-write) is skipped.
      }
    }
    return entries;
  }

  private async append(entry: HistoryEntry): Promise<void> {
    await this.serialized(async () => {
      const entries = await this.load();
      entries.push(entry);
      await mkdir(path.dirname(this.options.file), { recursive: true });
      const max = Math.max(1, this.options.maxEntries());
      if (entries.length > max * 1.1) {
        // Rewrite once in a while rather than on every run.
        this.cache = entries.slice(-max);
        await writeTextFileAtomic(
          this.options.file,
          this.cache.map((e) => JSON.stringify(e)).join('\n') + '\n',
          0o600,
        );
      } else {
        await appendFile(this.options.file, `${JSON.stringify(entry)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      }
    });
    this.options.onChange();
  }
}
