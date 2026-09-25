import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttributionColumn } from '../../shared/query/models';
import { ResultStore } from '../results/result-store';
import { ResultViews } from '../results/result-views';

import { ExportService } from './export-service';

const ATTRIBUTION: Record<AttributionColumn, string> = {
  _TenantName: 'Contoso',
  _TenantId: '00000000-0000-0000-0000-00000000c001',
  _SubscriptionName: 'SOC',
  _WorkspaceName: 'la-contoso',
  _WorkspaceId: '00000000-0000-0000-0000-000000000101',
  _Account: 'analyst@contoso.example',
};
const EMPTY = { sort: [], filters: {}, quickSearch: '', valueFilters: [] };

let dir = '';
const stores: ResultStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(saveTo: string | null = 'out.csv') {
  dir = mkdtempSync(path.join(tmpdir(), 'rk-export-'));
  const store = ResultStore.create(path.join(dir, 'cache'), {
    memoryBudgetBytes: () => 10_000_000,
    maxMergedRows: () => 1000,
  });
  stores.push(store);
  for (const [tableIndex, rows] of [
    [
      0,
      [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ],
    ],
    [1, [['x', 9]]],
  ] as const) {
    await store.addBatch({
      runId: 'r',
      tableIndex,
      tableName: 'T',
      workspaceKey: 'w',
      attribution: ATTRIBUTION,
      columns: [
        { name: 'Name', type: 'string' },
        { name: 'N', type: 'long' },
      ],
      rows: rows.map((r) => [...r]),
    });
  }
  const clipboard = vi.fn(() => Promise.resolve());
  const saveDialog = vi.fn(() =>
    Promise.resolve(saveTo === null ? undefined : path.join(dir, saveTo)),
  );
  let last: string | undefined;
  const service = new ExportService({
    store,
    views: new ResultViews(store),
    csv: () => ({ delimiter: ',', bom: false }),
    saveDialog,
    writeClipboard: clipboard,
    lastFolder: { get: () => last, set: (f) => (last = f) },
    defaultFolder: () => '/downloads',
    now: () => new Date('2026-09-25T10:11:12Z'),
  });
  return { service, clipboard, saveDialog, lastFolder: () => last };
}

describe('ExportService', () => {
  it('saves filtered rows of visible columns to the file the user picks', async () => {
    const { service, saveDialog, lastFolder } = await setup();
    const result = await service.export({
      source: {
        kind: 'table',
        runId: 'r',
        tableIndex: 0,
        view: {
          ...EMPTY,
          filters: { '7': { filterType: 'number', type: 'greaterThan', filter: 1 } },
        },
        scope: 'filtered',
        columns: [0, 6, 7],
      },
      format: 'csv',
      destination: 'file',
    });
    expect(result).toMatchObject({ status: 'saved', rows: 2 });
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: path.join('/downloads', 'raml-kql-results-2026-09-25-10-11-12.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    expect(readFileSync(path.join(dir, 'out.csv'), 'utf8')).toBe(
      '_TenantName,Name,N\r\nContoso,b,2\r\nContoso,c,3\r\n',
    );
    expect(lastFolder()).toBe(dir);
  });

  it('copies selected rows, with aliases when asked', async () => {
    const { service, clipboard } = await setup();
    const result = await service.export({
      source: {
        kind: 'table',
        runId: 'r',
        tableIndex: 0,
        view: EMPTY,
        scope: 'selected',
        positions: [2],
        columns: [0, 6],
      },
      format: 'markdown',
      destination: 'clipboard',
      display: {
        tenants: { [ATTRIBUTION._TenantId]: 'Customer 01' },
        workspaces: {},
        accounts: {},
      },
    });
    expect(result).toEqual({ status: 'copied', rows: 1 });
    expect(clipboard).toHaveBeenCalledWith(
      '| _TenantName | Name |\n| --- | --- |\n| Customer 01 | c |\n',
    );
  });

  it('writes every result table to its own sheet for XLSX of all rows', async () => {
    const { service } = await setup('out.xlsx');
    const result = await service.export({
      source: { kind: 'table', runId: 'r', tableIndex: 0, view: EMPTY, scope: 'all' },
      format: 'xlsx',
      destination: 'file',
    });
    expect(result).toMatchObject({ status: 'saved', rows: 4 });
    await expect(
      service.export({
        source: { kind: 'table', runId: 'r', tableIndex: 0, view: EMPTY, scope: 'all' },
        format: 'xlsx',
        destination: 'clipboard',
      }),
    ).rejects.toThrow('only be saved to a file');
  });

  it('exports inline (grouped) rows and handles a cancelled dialog', async () => {
    const { service, clipboard } = await setup(null);
    expect(
      await service.export({
        source: {
          kind: 'rows',
          name: 'Grouped',
          columns: [{ name: 'count_', type: 'long' }],
          rows: [[3]],
        },
        format: 'json',
        destination: 'file',
      }),
    ).toEqual({ status: 'cancelled', rows: 0 });
    await service.export({
      source: {
        kind: 'rows',
        name: 'Grouped',
        columns: [{ name: 'count_', type: 'long' }],
        rows: [[3]],
      },
      format: 'jsonl',
      destination: 'clipboard',
    });
    expect(clipboard).toHaveBeenCalledWith('{"count_":3}\n');
  });
});
