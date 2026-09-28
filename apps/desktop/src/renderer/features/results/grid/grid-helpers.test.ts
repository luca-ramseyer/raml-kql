import { describe, expect, it } from 'vitest';

import type { ResultColumn } from '../../../../shared/query/models';

import { formatCell, formatDateTimeCell, prettyJson, toTsv } from './cell-format';
import { buildColumnDefs, cellTooltip, viewFromGrid } from './column-defs';

describe('cell formatting', () => {
  it('formats datetimes ISO-like with milliseconds in the display zone', () => {
    expect(formatDateTimeCell('2026-09-24T09:12:03.1234567Z', 'utc')).toBe(
      '2026-09-24 09:12:03.123',
    );
    expect(formatDateTimeCell('not a date', 'utc')).toBe('not a date');
    const local = new Date(2026, 0, 2, 3, 4, 5, 6);
    expect(formatDateTimeCell(local.toISOString(), 'local')).toBe('2026-01-02 03:04:05.006');
  });

  it('compacts dynamic values and pretty-prints JSON for details', () => {
    expect(formatCell('{ "a": [1, 2] }', 'dynamic', 'utc')).toBe('{"a":[1,2]}');
    expect(formatCell(null, 'string', 'utc')).toBe('');
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('plain')).toBeUndefined();
  });

  it('copies rows as TSV with optional headers', () => {
    expect(
      toTsv(
        ['A', 'B'],
        [
          ['1', 'x\ty'],
          ['2', 'line\nbreak'],
        ],
      ),
    ).toBe('A\tB\n1\tx y\n2\tline break');
    expect(toTsv(undefined, [['1']])).toBe('1');
  });
});

describe('grid columns', () => {
  const columns: ResultColumn[] = [
    { name: '_TenantName', type: 'string', attribution: true },
    { name: '_TenantId', type: 'string', attribution: true },
    { name: 'TimeGenerated', type: 'datetime' },
    { name: 'Count', type: 'long', widenedFrom: ['int', 'long'] },
    { name: 'Hidden', type: 'string' },
  ];

  it('pins and shows attribution columns per setting, and picks filters by type', () => {
    const defs = buildColumnDefs(columns, {
      zone: 'utc',
      shownAttribution: ['_TenantName'],
      hidden: new Set(['Hidden']),
    });
    expect(defs.map((d): unknown[] => [d.field, d.pinned, d.hide, d.filter as unknown])).toEqual([
      ['c0', 'left', false, 'agTextColumnFilter'],
      ['c1', 'left', true, 'agTextColumnFilter'],
      ['c2', undefined, false, 'agDateColumnFilter'],
      ['c3', undefined, false, 'agNumberColumnFilter'],
      ['c4', undefined, true, 'agTextColumnFilter'],
    ]);
    const template = (defs[3]?.headerComponentParams as { template: string }).template;
    expect(template).toContain('codicon-symbol-numeric');
    expect(template).toContain('widened to long');
  });

  it('shows tooltips for datetimes and long values only', () => {
    expect(cellTooltip('2026-09-24T09:12:03.123Z', 'datetime', 'utc')).toMatch(
      /^UTC: 2026-09-24 09:12:03\.123\nLocal: /,
    );
    expect(cellTooltip('short', 'string', 'utc')).toBeUndefined();
    expect(cellTooltip('x'.repeat(3000), 'string', 'utc')).toHaveLength(2000);
    const defs = buildColumnDefs(columns, { zone: 'utc', shownAttribution: [], hidden: new Set() });
    expect(defs.every((d) => typeof d.tooltip === 'function' && !('tooltipValueGetter' in d))).toBe(
      true,
    );
  });

  it('turns the grid models into a view', () => {
    expect(
      viewFromGrid(
        [{ colId: 'c3', sort: 'desc' }],
        { c2: { filterType: 'date', type: 'equals', dateFrom: '2026-09-01 00:00:00' } },
        { quickSearch: 'x', valueFilters: [] },
      ),
    ).toEqual({
      sort: [{ column: 3, direction: 'desc' }],
      filters: { '2': { filterType: 'date', type: 'equals', dateFrom: '2026-09-01 00:00:00' } },
      quickSearch: 'x',
      valueFilters: [],
    });
  });
});
