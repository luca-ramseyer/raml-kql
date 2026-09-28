import { describe, expect, it } from 'vitest';

import type { HistoryEntry } from '../../../shared/query/history';

import { dayLabel, filterHistory, queryLabel } from './history-store';

const entry = (id: string, query: string, tenantIds: string[] = []): HistoryEntry => ({
  id,
  ts: '2026-09-25T10:00:00.000Z',
  query,
  targets: [],
  tenantIds,
  counts: { succeeded: 1, partial: 0, failed: 0, timeout: 0, cancelled: 0, skipped: 0 },
  rows: 1,
  durationMs: 10,
});

describe('history search', () => {
  const entries = [
    entry('a', 'SigninLogs | where ResultType != "0"', ['t1']),
    entry('b', 'Heartbeat | take 10', ['t2']),
  ];
  const names = (id: string) => (id === 't1' ? 'Customer 01' : 'Customer 02');

  it('matches query text, table names and tenant display names', () => {
    expect(filterHistory(entries, 'signinlogs', names).map((e) => e.id)).toEqual(['a']);
    expect(filterHistory(entries, 'customer 02', names).map((e) => e.id)).toEqual(['b']);
    expect(filterHistory(entries, 'heartbeat customer 01', names)).toEqual([]);
    expect(filterHistory(entries, '  ', names)).toHaveLength(2);
  });

  it('never matches hidden real tenant names while aliased', () => {
    expect(filterHistory(entries, 'contoso', names)).toEqual([]);
  });

  it('labels days and queries', () => {
    const now = new Date(2026, 8, 25, 12);
    expect(dayLabel(new Date(2026, 8, 25, 1).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 8, 24, 23).toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 8, 20).toISOString(), now)).not.toMatch(/Today|Yesterday/);
    expect(queryLabel('// comment\n\n  Heartbeat\n| take 1')).toBe('Heartbeat');
    expect(queryLabel('')).toBe('(empty query)');
  });
});
