import { describe, expect, it } from 'vitest';

import type { ResultColumn } from '../query/models';

import { GroupAggregator, MAX_GROUPS } from './aggregate';

const COLUMNS: ResultColumn[] = [
  { name: '_TenantName', type: 'string', attribution: true },
  { name: 'User', type: 'string' },
  { name: 'Bytes', type: 'long' },
  { name: 'TimeGenerated', type: 'datetime' },
];
const ROWS = [
  ['Contoso', 'a', 10, '2026-09-02T00:00:00Z'],
  ['Contoso', 'b', 20, '2026-09-01T00:00:00Z'],
  ['Contoso', 'a', null, '2026-09-03T00:00:00Z'],
  ['Fabrikam', 'c', 5, '2026-09-04T00:00:00Z'],
];

describe('GroupAggregator', () => {
  it('counts, distinct-counts, sums, averages and finds min/max per group', () => {
    const aggregator = new GroupAggregator(COLUMNS, {
      groupBy: [0],
      aggregations: [
        { fn: 'count' },
        { fn: 'dcount', column: 1 },
        { fn: 'sum', column: 2 },
        { fn: 'avg', column: 2 },
        { fn: 'min', column: 3 },
        { fn: 'max', column: 3 },
      ],
    });
    for (const row of ROWS) aggregator.add(row);
    const result = aggregator.result();
    expect(result.columns.map((c) => [c.name, c.type])).toEqual([
      ['_TenantName', 'string'],
      ['count_', 'long'],
      ['dcount_User', 'long'],
      ['sum_Bytes', 'real'],
      ['avg_Bytes', 'real'],
      ['min_TimeGenerated', 'datetime'],
      ['max_TimeGenerated', 'datetime'],
    ]);
    expect(result.columns[0]?.attribution).toBe(true);
    expect(result.rows).toEqual([
      ['Contoso', 3, 2, 30, 15, '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z'],
      ['Fabrikam', 1, 1, 5, 5, '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z'],
    ]);
  });

  it('groups by several columns, or none (a total row)', () => {
    const byTwo = new GroupAggregator(COLUMNS, {
      groupBy: [0, 1],
      aggregations: [{ fn: 'count' }],
    });
    ROWS.forEach((r) => {
      byTwo.add(r);
    });
    expect(byTwo.result().rows).toEqual([
      ['Contoso', 'a', 2],
      ['Contoso', 'b', 1],
      ['Fabrikam', 'c', 1],
    ]);
    const total = new GroupAggregator(COLUMNS, {
      groupBy: [],
      aggregations: [{ fn: 'sum', column: 2 }],
    });
    ROWS.forEach((r) => {
      total.add(r);
    });
    expect(total.result().rows).toEqual([[35]]);
  });

  it('caps the number of groups', () => {
    const aggregator = new GroupAggregator(COLUMNS, {
      groupBy: [1],
      aggregations: [{ fn: 'count' }],
    });
    for (let i = 0; i <= MAX_GROUPS; i++) aggregator.add(['T', `u${String(i)}`, 1, null]);
    const result = aggregator.result();
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(MAX_GROUPS);
  });
});
