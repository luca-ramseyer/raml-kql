import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AttributionColumn } from '../../shared/query/models';

import { ResultStore } from './result-store';

const ATTRIBUTION = (workspace: string): Record<AttributionColumn, string> => ({
  _TenantName: 'Contoso',
  _TenantId: '00000000-0000-0000-0000-00000000c001',
  _SubscriptionName: 'SOC-Prod',
  _WorkspaceName: workspace,
  _WorkspaceId: '00000000-0000-0000-0000-000000000101',
  _Account: 'analyst@contoso.example',
});

let dir: string | undefined;
const stores: ResultStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function create(options: { budget?: number; maxRows?: number } = {}): ResultStore {
  dir = mkdtempSync(path.join(tmpdir(), 'rk-results-'));
  const store = ResultStore.create(path.join(dir, 'session-cache'), {
    memoryBudgetBytes: () => options.budget ?? 10_000_000,
    maxMergedRows: () => options.maxRows ?? 1_000_000,
  });
  stores.push(store);
  return store;
}

const rows = (n: number, prefix: string): unknown[][] =>
  Array.from({ length: n }, (_, i) => [`${prefix}-${String(i)}`, i]);

describe('ResultStore', () => {
  it('merges columns by name, widens conflicting types and fills missing columns with null', async () => {
    const store = create();
    await store.addBatch({
      runId: 'r1',
      tableIndex: 0,
      tableName: 'PrimaryResult',
      workspaceKey: 'w1',
      attribution: ATTRIBUTION('la-1'),
      columns: [
        { name: 'Computer', type: 'string' },
        { name: 'Score', type: 'long' },
      ],
      rows: [['ws-1', 5]],
    });
    await store.addBatch({
      runId: 'r1',
      tableIndex: 0,
      tableName: 'PrimaryResult',
      workspaceKey: 'w2',
      attribution: ATTRIBUTION('la-2'),
      columns: [
        { name: 'Score', type: 'real' },
        { name: 'Extra', type: 'dynamic' },
        { name: 'Computer', type: 'bool' },
      ],
      rows: [[1.5, '{"a":1}', true]],
    });
    const [table] = store.tables('r1');
    expect(table?.columns.slice(6)).toEqual([
      { name: 'Computer', type: 'string', widenedFrom: ['bool', 'string'] },
      { name: 'Score', type: 'real', widenedFrom: ['long', 'real'] },
      { name: 'Extra', type: 'dynamic' },
    ]);
    const page = await store.page('r1', 0, 0, 10);
    expect(page.rows.map((r) => r.slice(3, 4).concat(r.slice(6)))).toEqual([
      ['la-1', 'ws-1', 5, null],
      ['la-2', 'true', 1.5, '{"a":1}'],
    ]);
  });

  it('pages across batches', async () => {
    const store = create();
    for (const w of ['w1', 'w2', 'w3']) {
      await store.addBatch({
        runId: 'r1',
        tableIndex: 0,
        tableName: 'T',
        workspaceKey: w,
        attribution: ATTRIBUTION(w),
        columns: [
          { name: 'Name', type: 'string' },
          { name: 'N', type: 'long' },
        ],
        rows: rows(4, w),
      });
    }
    const page = await store.page('r1', 0, 3, 5);
    expect(page.rows.map((r) => r[6])).toEqual(['w1-3', 'w2-0', 'w2-1', 'w2-2', 'w2-3']);
    expect((await store.page('r1', 0, 11, 5)).rows.map((r) => r[6])).toEqual(['w3-3']);
    expect((await store.page('r1', 5, 0, 5)).rows).toEqual([]);
    expect((await store.page('nope', 0, 0, 5)).rows).toEqual([]);
  });

  it('spills over budget to encrypted files and reads them back', async () => {
    const store = create({ budget: 1000 });
    for (const w of ['w1', 'w2', 'w3']) {
      await store.addBatch({
        runId: 'r1',
        tableIndex: 0,
        tableName: 'T',
        workspaceKey: w,
        attribution: ATTRIBUTION(w),
        columns: [
          { name: 'Name', type: 'string' },
          { name: 'N', type: 'long' },
        ],
        rows: rows(30, `secret-${w}`),
      });
    }
    expect(store.bytesInMemory).toBeLessThanOrEqual(1000);
    const files = readdirSync(store.directory);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Encrypted: none of the values appear on disk.
      expect(readFileSync(path.join(store.directory, file)).toString('latin1')).not.toContain(
        'secret',
      );
    }
    const page = await store.page('r1', 0, 0, 100);
    expect(page.rows).toHaveLength(90);
    expect(page.rows[0]?.[6]).toBe('secret-w1-0');
    expect(page.rows[89]?.[6]).toBe('secret-w3-29');

    await store.deleteRun('r1');
    expect(readdirSync(store.directory)).toEqual([]);
  });

  it('stops at the merged row cap', async () => {
    const store = create({ maxRows: 5 });
    const add = (w: string) =>
      store.addBatch({
        runId: 'r1',
        tableIndex: 0,
        tableName: 'T',
        workspaceKey: w,
        attribution: ATTRIBUTION(w),
        columns: [{ name: 'Name', type: 'string' }],
        rows: rows(3, w).map((r) => [r[0]]),
      });
    expect(await add('w1')).toEqual({ accepted: 3, truncated: false });
    expect(await add('w2')).toEqual({ accepted: 2, truncated: true });
    expect(await add('w3')).toEqual({ accepted: 0, truncated: true });
    expect(store.truncated('r1')).toBe(true);
    expect(store.tables('r1')[0]?.rowCount).toBe(5);

    await store.removeWorkspace('r1', 'w2');
    expect(store.tables('r1')[0]?.rowCount).toBe(3);
    expect(store.truncated('r1')).toBe(false);
  });

  it('is gone after dispose: files deleted and key zeroed', async () => {
    const store = create({ budget: 10 });
    await store.addBatch({
      runId: 'r1',
      tableIndex: 0,
      tableName: 'T',
      workspaceKey: 'w1',
      attribution: ATTRIBUTION('w1'),
      columns: [{ name: 'Name', type: 'string' }],
      rows: [['value']],
    });
    const key = (store as unknown as { key: Buffer }).key;
    expect(existsSync(store.directory)).toBe(true);
    store.dispose();
    expect(existsSync(store.directory)).toBe(false);
    expect(key.every((byte) => byte === 0)).toBe(true);
    expect((store as unknown as { key: Buffer }).key.length).toBe(0);
    await expect(store.page('r1', 0, 0, 1)).rejects.toThrow('disposed');
    store.dispose(); // idempotent
  });

  it('wipes leftovers of a crashed session on start', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-results-'));
    const base = path.join(dir, 'session-cache');
    const leftover = path.join(base, 'crashed-session');
    mkdirSync(leftover, { recursive: true });
    writeFileSync(path.join(leftover, '1.bin'), 'ciphertext of a dead key');
    const store = ResultStore.create(base, { memoryBudgetBytes: () => 1, maxMergedRows: () => 1 });
    stores.push(store);
    expect(existsSync(leftover)).toBe(false);
    expect(readdirSync(base)).toEqual([path.basename(store.directory)]);
  });
});
