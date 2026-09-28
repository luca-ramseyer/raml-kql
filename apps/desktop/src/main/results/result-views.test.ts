import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AttributionColumn } from '../../shared/query/models';
import type { DisplayNames } from '../../shared/results/display-names';
import type { ViewStateInput } from '../../shared/results/view';
import { ViewStateSchema } from '../../shared/results/view';

import { ResultStore } from './result-store';
import { filterPredicate, ResultViews } from './result-views';

const TENANT_A = '00000000-0000-0000-0000-00000000c001';
const TENANT_B = '00000000-0000-0000-0000-00000000c004';

function attribution(
  tenantId: string,
  tenant: string,
  workspace: string,
  id: string,
): Record<AttributionColumn, string> {
  return {
    _TenantName: tenant,
    _TenantId: tenantId,
    _SubscriptionName: 'SOC',
    _WorkspaceName: workspace,
    _WorkspaceId: id,
    _Account: 'analyst@contoso.example',
  };
}

let dir: string | undefined;
const stores: ResultStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function setup(options: { budget?: number } = {}) {
  dir = mkdtempSync(path.join(tmpdir(), 'rk-views-'));
  const store = ResultStore.create(path.join(dir, 'cache'), {
    memoryBudgetBytes: () => options.budget ?? 10_000_000,
    maxMergedRows: () => 1_000_000,
  });
  stores.push(store);
  const columns = [
    { name: 'TimeGenerated', type: 'datetime' as const },
    { name: 'Computer', type: 'string' as const },
    { name: 'Count', type: 'long' as const },
  ];
  await store.addBatch({
    runId: 'r',
    tableIndex: 0,
    tableName: 'T',
    workspaceKey: 'w1',
    attribution: attribution(
      TENANT_A,
      'Contoso',
      'la-contoso',
      '00000000-0000-0000-0000-000000000101',
    ),
    columns,
    rows: [
      ['2026-09-01T10:00:00Z', 'ws-b', 5],
      ['2026-09-02T10:00:00.5Z', 'WS-A', null],
      ['2026-09-03T10:00:00Z', 'ws-c', 20],
    ],
  });
  await store.addBatch({
    runId: 'r',
    tableIndex: 0,
    tableName: 'T',
    workspaceKey: 'w2',
    attribution: attribution(
      TENANT_B,
      'Fabrikam',
      'la-fabrikam',
      '00000000-0000-0000-0000-000000000102',
    ),
    columns,
    rows: [
      ['2026-09-02T00:00:00Z', 'ws-d', 7],
      ['2026-09-01T23:59:59Z', 'ws-a', 3],
    ],
  });
  return { store, views: new ResultViews(store) };
}

const view = (input: ViewStateInput) => ViewStateSchema.parse(input);
// Column indexes: 0-5 attribution, 6 TimeGenerated, 7 Computer, 8 Count.

describe('ResultViews', () => {
  it('pages the plain table in merged order', async () => {
    const { views } = await setup();
    const page = await views.page({
      runId: 'r',
      tableIndex: 0,
      view: view({}),
      offset: 1,
      limit: 3,
    });
    expect(page).toMatchObject({ rowCount: 5, totalRows: 5, positions: [1, 2, 3] });
    expect(page.rows.map((r) => r[7])).toEqual(['WS-A', 'ws-c', 'ws-d']);
  });

  it('sorts by type (numbers, datetimes with fractions, text case-insensitively), empties last', async () => {
    const { views } = await setup();
    const computers = async (sort: { column: number; direction: 'asc' | 'desc' }[]) =>
      (
        await views.page({ runId: 'r', tableIndex: 0, view: view({ sort }), offset: 0, limit: 10 })
      ).rows.map((r) => r[7]);
    expect(await computers([{ column: 8, direction: 'desc' }])).toEqual([
      'ws-c',
      'ws-d',
      'ws-b',
      'ws-a',
      'WS-A',
    ]);
    expect(await computers([{ column: 8, direction: 'asc' }])).toEqual([
      'ws-a',
      'ws-b',
      'ws-d',
      'ws-c',
      'WS-A',
    ]);
    expect(await computers([{ column: 6, direction: 'asc' }])).toEqual([
      'ws-b',
      'ws-a',
      'ws-d',
      'WS-A',
      'ws-c',
    ]);
    // Multi-sort: Computer (case-insensitive) then Count descending.
    expect(
      await computers([
        { column: 7, direction: 'asc' },
        { column: 8, direction: 'desc' },
      ]),
    ).toEqual(['ws-a', 'WS-A', 'ws-b', 'ws-c', 'ws-d']);
  });

  it('filters with text, number, date and value conditions and quick search', async () => {
    const { views } = await setup();
    const count = async (input: ViewStateInput) =>
      (await views.page({ runId: 'r', tableIndex: 0, view: view(input), offset: 0, limit: 10 }))
        .rowCount;
    expect(
      await count({ filters: { '7': { filterType: 'text', type: 'equals', filter: 'ws-a' } } }),
    ).toBe(2);
    expect(
      await count({ filters: { '8': { filterType: 'number', type: 'greaterThan', filter: 5 } } }),
    ).toBe(2);
    expect(await count({ filters: { '8': { filterType: 'number', type: 'blank' } } })).toBe(1);
    expect(
      await count({
        filters: { '6': { filterType: 'date', type: 'equals', dateFrom: '2026-09-01 00:00:00' } },
      }),
    ).toBe(2);
    expect(
      await count({
        filters: {
          '8': {
            filterType: 'number',
            operator: 'OR',
            conditions: [
              { filterType: 'number', type: 'lessThan', filter: 4 },
              { filterType: 'number', type: 'equals', filter: 20 },
            ],
          },
        },
      }),
    ).toBe(2);
    expect(
      await count({
        filters: { '0': { filterType: 'values', mode: 'exclude', values: ['Contoso'] } },
      }),
    ).toBe(2);
    expect(
      await count({ valueFilters: [{ column: 7, mode: 'include', values: ['ws-a', 'ws-b'] }] }),
    ).toBe(2);
    expect(
      await count({
        valueFilters: [{ column: 0, mode: 'exclude', values: ['Fabrikam'] }],
        filters: { '8': { filterType: 'number', type: 'notBlank' } },
      }),
    ).toBe(2);
    expect(await count({ quickSearch: 'WS-A' })).toBe(2);
    expect(await count({ quickSearch: 'fabrikam' })).toBe(2);
  });

  it('matches on display names while aliased, never on hidden real names', async () => {
    const { views } = await setup();
    const display: DisplayNames = {
      tenants: { [TENANT_A]: 'Customer 01', [TENANT_B]: 'Customer 02' },
      workspaces: {},
      accounts: {},
    };
    const page = async (input: ViewStateInput) =>
      views.page({ runId: 'r', tableIndex: 0, view: view(input), display, offset: 0, limit: 10 });
    expect((await page({ quickSearch: 'fabrikam' })).rowCount).toBe(0);
    expect((await page({ quickSearch: 'customer 02' })).rowCount).toBe(2);
    const rows = (await page({})).rows;
    expect(rows.map((r) => [r[0], r[3]])[0]).toEqual(['Customer 01', 'Unlisted workspace']);
  });

  it('caches views by table version and recomputes after new rows', async () => {
    const { store, views } = await setup();
    const state = view({ sort: [{ column: 8, direction: 'desc' }] });
    const first = await views.positions('r', 0, state, undefined);
    expect(await views.positions('r', 0, state, undefined)).toBe(first);
    await store.addBatch({
      runId: 'r',
      tableIndex: 0,
      tableName: 'T',
      workspaceKey: 'w3',
      attribution: attribution(TENANT_B, 'Fabrikam', 'x', 'y'),
      columns: [{ name: 'Count', type: 'long' }],
      rows: [[99]],
    });
    const second = await views.positions('r', 0, state, undefined);
    expect(second).not.toBe(first);
    expect(second?.[0]).toBe(5);
  });

  it('works on spilled, encrypted batches', async () => {
    const { views } = await setup({ budget: 1 });
    const page = await views.page({
      runId: 'r',
      tableIndex: 0,
      view: view({ sort: [{ column: 7, direction: 'desc' }] }),
      offset: 0,
      limit: 2,
    });
    expect(page.rows.map((r) => r[7])).toEqual(['ws-d', 'ws-c']);
  });

  it('aggregates and extracts chart data over the view', async () => {
    const { views } = await setup();
    const grouped = await views.aggregate({
      runId: 'r',
      tableIndex: 0,
      view: view({}),
      spec: { groupBy: [0], aggregations: [{ fn: 'count' }, { fn: 'sum', column: 8 }] },
    });
    expect(grouped.rows).toEqual([
      ['Contoso', 3, 25],
      ['Fabrikam', 2, 10],
    ]);
    const chart = await views.chartData({
      runId: 'r',
      tableIndex: 0,
      view: view({ quickSearch: 'ws-a' }),
      columns: [6, 8],
    });
    expect(chart.columns.map((c) => c.name)).toEqual(['TimeGenerated', 'Count']);
    expect(chart.rows).toEqual([
      ['2026-09-02T10:00:00.5Z', null],
      ['2026-09-01T23:59:59Z', 3],
    ]);
  });
});

describe('filterPredicate', () => {
  it('handles text operators case-insensitively and blanks', () => {
    const t = (
      type: 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'notEqual' | 'notBlank',
      filter = 'Ab',
    ) => filterPredicate({ filterType: 'text', type, filter });
    expect(t('contains')('xaby')).toBe(true);
    expect(t('notContains')('xaby')).toBe(false);
    expect(t('startsWith')('ABC')).toBe(true);
    expect(t('endsWith')('cab')).toBe(true);
    expect(t('notEqual')('ab')).toBe(false);
    expect(t('notBlank')('')).toBe(false);
  });

  it('handles number and date ranges', () => {
    const range = filterPredicate({
      filterType: 'number',
      type: 'inRange',
      filter: 1,
      filterTo: 3,
    });
    expect([0, 1, 3, 4, null].map(range)).toEqual([false, true, true, false, false]);
    const days = filterPredicate({
      filterType: 'date',
      type: 'inRange',
      dateFrom: '2026-09-01 00:00:00',
      dateTo: '2026-09-02 00:00:00',
    });
    expect(
      [
        '2026-08-31T23:59:59Z',
        '2026-09-01T00:00:00Z',
        '2026-09-02T23:59:59Z',
        '2026-09-03T00:00:00Z',
      ].map(days),
    ).toEqual([false, true, true, false]);
    const after = filterPredicate({
      filterType: 'date',
      type: 'greaterThan',
      dateFrom: '2026-09-01 00:00:00',
    });
    expect(['2026-09-01T12:00:00Z', '2026-09-02T00:00:00Z'].map(after)).toEqual([false, true]);
  });
});
