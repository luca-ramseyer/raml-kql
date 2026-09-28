import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ATTRIBUTION_COLUMNS,
  type AttributionColumn,
  type ResultColumn,
  type ResultPage,
  type ResultTableInfo,
} from '../../shared/query/models';
import { valueText } from '../../shared/results/values';
import { widenKqlType, type KqlType } from '../../shared/schema/models';

/**
 * The session result store (spec 04, "Result store"). Results live in memory; above the
 * memory budget the oldest batches spill to disk, encrypted with AES-256-GCM under a session
 * key that exists only in this process's memory. `dispose()` deletes the files and zeroes the
 * key; `create()` wipes leftovers of earlier sessions (crashes), which are unreadable anyway
 * because their key died with the process.
 *
 * Rows are stored per workspace batch, with the attribution values once per batch; merged
 * columns are resolved when a page is read.
 */

export interface BatchColumn {
  name: string;
  type: KqlType;
}

interface Batch {
  id: number;
  runId: string;
  workspaceKey: string;
  attribution: Record<AttributionColumn, string>;
  columns: BatchColumn[];
  columnIndex: Map<string, number>;
  rowCount: number;
  bytes: number;
  rows: unknown[][] | undefined;
  file: string | undefined;
}

interface MergedColumnState {
  name: string;
  type: KqlType;
  types: Set<KqlType>;
}

interface StoredTable {
  /** Increases whenever rows are added or removed (invalidates cached views). */
  version: number;
  name: string;
  columns: MergedColumnState[];
  batches: Batch[];
  rowCount: number;
}

interface StoredRun {
  /** Indexed by result table index; sparse until every table has arrived. */
  tables: (StoredTable | undefined)[];
  rowCount: number;
  truncated: boolean;
}

export interface ResultStoreOptions {
  /** Session directory; created now, deleted by `dispose()`. */
  dir: string;
  memoryBudgetBytes: () => number;
  maxMergedRows: () => number;
}

const IV_BYTES = 12;
/** Decrypted spilled batches kept for random access (sorted views jump between batches). */
const READ_CACHE_BATCHES = 8;
const TAG_BYTES = 16;

export class ResultStore {
  private key: Buffer;
  private readonly runs = new Map<string, StoredRun>();
  private nextBatchId = 1;
  private memoryBytes = 0;
  private disposed = false;
  /** Recently read spilled batches (most recent last), so random access doesn't decrypt each time. */
  private readCache: { batchId: number; rows: unknown[][] }[] = [];

  private constructor(private readonly options: ResultStoreOptions) {
    this.key = randomBytes(32);
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  }

  /**
   * Wipe `<baseDir>` (leftovers of crashed sessions) and start a store in a fresh session
   * directory inside it.
   */
  static create(baseDir: string, options: Omit<ResultStoreOptions, 'dir'>): ResultStore {
    rmSync(baseDir, { recursive: true, force: true });
    return new ResultStore({ ...options, dir: path.join(baseDir, randomUUID()) });
  }

  get directory(): string {
    return this.options.dir;
  }

  /** Bytes currently held in memory (not spilled). */
  get bytesInMemory(): number {
    return this.memoryBytes;
  }

  /**
   * Add one workspace's rows for a result table. Stops at `maxMergedRows` for the run and
   * reports whether rows were dropped.
   */
  async addBatch(input: {
    runId: string;
    tableIndex: number;
    tableName: string;
    workspaceKey: string;
    attribution: Record<AttributionColumn, string>;
    columns: BatchColumn[];
    rows: unknown[][];
  }): Promise<{ accepted: number; truncated: boolean }> {
    this.assertUsable();
    const run = this.runFor(input.runId);
    const room = Math.max(0, this.options.maxMergedRows() - run.rowCount);
    const rows = input.rows.length > room ? input.rows.slice(0, room) : input.rows;
    const truncated = rows.length < input.rows.length;
    if (truncated) run.truncated = true;

    let table = run.tables[input.tableIndex];
    if (table === undefined) {
      table = { name: input.tableName, columns: [], batches: [], rowCount: 0, version: 0 };
      run.tables[input.tableIndex] = table;
    }
    for (const column of input.columns) {
      const existing = table.columns.find((c) => c.name === column.name);
      if (existing === undefined) {
        table.columns.push({ name: column.name, type: column.type, types: new Set([column.type]) });
      } else {
        existing.types.add(column.type);
        existing.type = widenKqlType(existing.type, column.type);
      }
    }
    if (rows.length === 0 && input.rows.length > 0) return { accepted: 0, truncated };

    const bytes = Buffer.byteLength(JSON.stringify(rows));
    const batch: Batch = {
      id: this.nextBatchId++,
      runId: input.runId,
      workspaceKey: input.workspaceKey,
      attribution: input.attribution,
      columns: input.columns,
      columnIndex: new Map(input.columns.map((c, i) => [c.name, i])),
      rowCount: rows.length,
      bytes,
      rows,
      file: undefined,
    };
    table.batches.push(batch);
    table.rowCount += rows.length;
    table.version += 1;
    run.rowCount += rows.length;
    this.memoryBytes += bytes;
    await this.enforceBudget();
    return { accepted: rows.length, truncated };
  }

  /** Remove a workspace's rows from a run (before re-running it). */
  async removeWorkspace(runId: string, workspaceKey: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
    for (const table of run.tables) {
      if (table === undefined) continue;
      const removed = table.batches.filter((b) => b.workspaceKey === workspaceKey);
      table.batches = table.batches.filter((b) => b.workspaceKey !== workspaceKey);
      for (const batch of removed) {
        table.rowCount -= batch.rowCount;
        table.version += 1;
        run.rowCount -= batch.rowCount;
        await this.dropBatch(batch);
      }
    }
    run.truncated = false;
  }

  tables(runId: string): ResultTableInfo[] {
    const run = this.runs.get(runId);
    if (run === undefined) return [];
    return run.tables.flatMap((table, index) =>
      table === undefined
        ? []
        : [{ index, name: table.name, rowCount: table.rowCount, columns: mergedColumns(table) }],
    );
  }

  truncated(runId: string): boolean {
    return this.runs.get(runId)?.truncated ?? false;
  }

  async page(
    runId: string,
    tableIndex: number,
    offset: number,
    limit: number,
  ): Promise<ResultPage> {
    this.assertUsable();
    const table = this.runs.get(runId)?.tables[tableIndex];
    if (table === undefined) {
      return { runId, tableIndex, offset, columns: [], rows: [] };
    }
    const columns = mergedColumns(table);
    const rows: unknown[][] = [];
    let skip = offset;
    for (const batch of table.batches) {
      if (rows.length >= limit) break;
      if (skip >= batch.rowCount) {
        skip -= batch.rowCount;
        continue;
      }
      const batchRows = await this.rowsOf(batch);
      const end = Math.min(batch.rowCount, skip + (limit - rows.length));
      for (let r = skip; r < end; r++) {
        rows.push(projectRow(batch, batchRows[r] ?? [], table.columns));
      }
      skip = 0;
    }
    return { runId, tableIndex, offset, columns, rows: rows as ResultPage['rows'] };
  }

  /** Version of a table's contents; changes whenever rows are added or removed. */
  tableVersion(runId: string, tableIndex: number): number | undefined {
    return this.runs.get(runId)?.tables[tableIndex]?.version;
  }

  /** Merged columns of a table (attribution first). */
  columns(runId: string, tableIndex: number): ResultColumn[] {
    const table = this.runs.get(runId)?.tables[tableIndex];
    return table === undefined ? [] : mergedColumns(table);
  }

  /** Rows by position in merged order (for sorted/filtered views). */
  async rowsAt(
    runId: string,
    tableIndex: number,
    positions: readonly number[],
  ): Promise<unknown[][]> {
    this.assertUsable();
    const table = this.runs.get(runId)?.tables[tableIndex];
    if (table === undefined) return [];
    const starts: number[] = [];
    let offset = 0;
    for (const batch of table.batches) {
      starts.push(offset);
      offset += batch.rowCount;
    }
    const out: unknown[][] = [];
    for (const position of positions) {
      // Binary search for the batch containing this position.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((starts[mid] ?? 0) <= position) lo = mid;
        else hi = mid - 1;
      }
      const batch = table.batches[lo];
      if (batch === undefined || position >= offset) continue;
      const rows = await this.rowsOf(batch);
      out.push(projectRow(batch, rows[position - (starts[lo] ?? 0)] ?? [], table.columns));
    }
    return out;
  }

  /**
   * Visit every row of a table in merged order, batch by batch (sorting, filtering, grouping,
   * export). `visit` receives the projected row and its position.
   */
  async forEachRow(
    runId: string,
    tableIndex: number,
    visit: (row: unknown[], position: number) => void,
  ): Promise<void> {
    this.assertUsable();
    const table = this.runs.get(runId)?.tables[tableIndex];
    if (table === undefined) return;
    let position = 0;
    for (const batch of table.batches) {
      const rows = await this.rowsOf(batch);
      for (let r = 0; r < batch.rowCount; r++) {
        visit(projectRow(batch, rows[r] ?? [], table.columns), position++);
      }
    }
  }

  async deleteRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
    this.runs.delete(runId);
    for (const table of run.tables) {
      for (const batch of table?.batches ?? []) await this.dropBatch(batch);
    }
  }

  async clear(): Promise<void> {
    for (const runId of [...this.runs.keys()]) await this.deleteRun(runId);
  }

  /** Delete every file and zero the key (quit). The store is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runs.clear();
    this.readCache = [];
    this.memoryBytes = 0;
    rmSync(this.options.dir, { recursive: true, force: true });
    this.key.fill(0);
    this.key = Buffer.alloc(0);
  }

  // --- Internals ----------------------------------------------------------------------------

  private assertUsable(): void {
    if (this.disposed) throw new Error('The result store has been disposed.');
  }

  private runFor(runId: string): StoredRun {
    let run = this.runs.get(runId);
    if (run === undefined) {
      run = { tables: [], rowCount: 0, truncated: false };
      this.runs.set(runId, run);
    }
    return run;
  }

  private async rowsOf(batch: Batch): Promise<unknown[][]> {
    if (batch.rows !== undefined) return batch.rows;
    const cachedIndex = this.readCache.findIndex((entry) => entry.batchId === batch.id);
    if (cachedIndex >= 0) {
      const [entry] = this.readCache.splice(cachedIndex, 1);
      if (entry !== undefined) {
        this.readCache.push(entry);
        return entry.rows;
      }
    }
    if (batch.file === undefined) return [];
    const data = await readFile(batch.file);
    const rows = JSON.parse(this.decrypt(data, batch.runId).toString('utf8')) as unknown[][];
    this.readCache.push({ batchId: batch.id, rows });
    if (this.readCache.length > READ_CACHE_BATCHES) this.readCache.shift();
    return rows;
  }

  private async dropBatch(batch: Batch): Promise<void> {
    if (batch.rows !== undefined) this.memoryBytes -= batch.bytes;
    batch.rows = undefined;
    this.readCache = this.readCache.filter((entry) => entry.batchId !== batch.id);
    if (batch.file !== undefined) {
      await rm(batch.file, { force: true });
      batch.file = undefined;
    }
  }

  /** Spill the oldest in-memory batches until the store fits the budget again. */
  private async enforceBudget(): Promise<void> {
    const budget = this.options.memoryBudgetBytes();
    if (this.memoryBytes <= budget) return;
    const inMemory = [...this.runs.values()]
      .flatMap((run) => run.tables.flatMap((table) => table?.batches ?? []))
      .filter((batch) => batch.rows !== undefined)
      .sort((a, b) => a.id - b.id);
    for (const batch of inMemory) {
      if (this.memoryBytes <= budget) break;
      const rows = batch.rows;
      if (rows === undefined) continue;
      const file = path.join(this.options.dir, `${String(batch.id)}.bin`);
      await writeFile(file, this.encrypt(Buffer.from(JSON.stringify(rows)), batch.runId), {
        mode: 0o600,
      });
      batch.file = file;
      batch.rows = undefined;
      this.memoryBytes -= batch.bytes;
    }
  }

  private encrypt(plain: Buffer, runId: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(runId, 'utf8'));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  private decrypt(data: Buffer, runId: string): Buffer {
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(runId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  }
}

function mergedColumns(table: StoredTable): ResultColumn[] {
  return [
    ...ATTRIBUTION_COLUMNS.map((name) => ({ name, type: 'string' as const, attribution: true })),
    ...table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      ...(column.types.size > 1 ? { widenedFrom: [...column.types].sort() } : {}),
    })),
  ];
}

/** One stored row in merged-column order: attribution, then columns (null where missing). */
function projectRow(batch: Batch, row: unknown[], merged: MergedColumnState[]): unknown[] {
  const out: unknown[] = ATTRIBUTION_COLUMNS.map((name) => batch.attribution[name]);
  for (const column of merged) {
    const index = batch.columnIndex.get(column.name);
    const value = index === undefined ? null : (row[index] ?? null);
    const batchType = index === undefined ? column.type : batch.columns[index]?.type;
    out.push(
      column.type === 'string' && batchType !== 'string' && value !== null
        ? valueText(value)
        : value,
    );
  }
  return out;
}
