import { describe, expect, it } from 'vitest';

import type { RenderSpec, ResultColumn } from '../../../../shared/query/models';

import { buildChartModel, MAX_POINTS, resolveChart } from './chart-model';
import { readChartColors, toEChartsOption } from './echarts-option';
import { lttb } from './lttb';

const COLUMNS: ResultColumn[] = [
  { name: '_TenantName', type: 'string', attribution: true },
  { name: 'TimeGenerated', type: 'datetime' },
  { name: 'Computer', type: 'string' },
  { name: 'count_', type: 'long' },
];
const ROWS = [
  ['Contoso', '2026-09-01T00:00:00Z', 'ws-1', 2],
  ['Contoso', '2026-09-01T01:00:00Z', 'ws-1', 3],
  ['Fabrikam', '2026-09-01T00:00:00Z', 'ws-2', 5],
  ['Fabrikam', '2026-09-01T00:00:00Z', 'ws-3', 1],
];
const render = (visualization: string, properties?: RenderSpec['properties']): RenderSpec => ({
  visualization,
  ...(properties === undefined ? {} : { properties }),
});

describe('resolveChart: every render kind (spec 06)', () => {
  it.each([
    ['timechart', 'line'],
    ['linechart', 'line'],
    ['areachart', 'area'],
    ['columnchart', 'column'],
    ['barchart', 'bar'],
    ['piechart', 'pie'],
    ['scatterchart', 'scatter'],
    ['anomalychart', 'line'],
    ['card', 'card'],
  ])('%s → %s', (visualization, kind) => {
    expect(resolveChart(render(visualization), {}, COLUMNS)?.kind).toBe(kind);
  });

  it('draws nothing for `table` or no render, unless the builder picks a chart', () => {
    expect(resolveChart(render('table'), {}, COLUMNS)).toBeUndefined();
    expect(resolveChart(undefined, {}, COLUMNS)).toBeUndefined();
    expect(resolveChart(undefined, { kind: 'pie' }, COLUMNS)?.kind).toBe('pie');
  });

  it('stacks area charts when kind says so, and honours render properties', () => {
    expect(resolveChart(render('areachart', { kind: 'stacked' }), {}, COLUMNS)?.kind).toBe(
      'stackedArea',
    );
    const chart = resolveChart(
      render('columnchart', {
        xcolumn: 'Computer',
        ycolumns: 'count_',
        title: 'Events',
        ymin: 0,
        legend: 'hidden',
      }),
      {},
      COLUMNS,
    );
    expect(chart).toMatchObject({
      x: 'Computer',
      y: ['count_'],
      title: 'Events',
      yMin: 0,
      legend: false,
    });
  });

  it('uses Kusto defaults: first datetime as x, numeric y, string series for time charts', () => {
    expect(resolveChart(render('timechart'), {}, COLUMNS)).toMatchObject({
      x: 'TimeGenerated',
      y: ['count_'],
      series: 'Computer',
      splitByTenant: false,
    });
  });

  it('splits by tenant by default when there is no explicit series', () => {
    const noSeries = COLUMNS.filter((c) => c.name !== 'Computer');
    expect(resolveChart(render('timechart'), {}, noSeries)?.splitByTenant).toBe(true);
    expect(
      resolveChart(render('timechart'), { splitByTenant: false }, noSeries)?.splitByTenant,
    ).toBe(false);
  });
});

describe('buildChartModel', () => {
  it('builds time series per series value, sorted by time', () => {
    const chart = resolveChart(render('timechart'), {}, COLUMNS);
    if (chart === undefined) throw new Error('no chart');
    const model = buildChartModel(chart, COLUMNS, ROWS);
    expect(model.xType).toBe('time');
    expect(model.series.map((s) => [s.name, s.points])).toEqual([
      [
        'ws-1',
        [
          [Date.parse('2026-09-01T00:00:00Z'), 2],
          [Date.parse('2026-09-01T01:00:00Z'), 3],
        ],
      ],
      ['ws-2', [[Date.parse('2026-09-01T00:00:00Z'), 5]]],
      ['ws-3', [[Date.parse('2026-09-01T00:00:00Z'), 1]]],
    ]);
  });

  it('splits by tenant and sums rows at the same x', () => {
    const chart = resolveChart(
      render('timechart'),
      { series: undefined, splitByTenant: true, x: 'TimeGenerated' },
      COLUMNS.filter((c) => c.name !== 'Computer'),
    );
    if (chart === undefined) throw new Error('no chart');
    const model = buildChartModel(chart, COLUMNS, ROWS);
    expect(model.series.map((s) => [s.name, s.points.map((p) => p[1])])).toEqual([
      ['Contoso', [2, 3]],
      ['Fabrikam', [6]],
    ]);
  });

  it('aggregates categories for column charts and pies', () => {
    const settings = {
      kind: 'column' as const,
      x: 'Computer',
      y: ['count_'],
      aggregation: 'max' as const,
    };
    const chart = resolveChart(undefined, { ...settings, splitByTenant: false }, COLUMNS);
    if (chart === undefined) throw new Error('no chart');
    const model = buildChartModel(chart, COLUMNS, ROWS);
    expect(model.xType).toBe('category');
    expect(model.series[0]?.points).toEqual([
      ['ws-1', 3],
      ['ws-2', 5],
      ['ws-3', 1],
    ]);
    // Split by tenant is on by default with several tenants: one series per tenant.
    const split = resolveChart(undefined, settings, COLUMNS);
    if (split === undefined) throw new Error('no chart');
    expect(buildChartModel(split, COLUMNS, ROWS).series.map((s) => s.name)).toEqual([
      'Contoso',
      'Fabrikam',
    ]);
  });

  it('shows a card value', () => {
    const chart = resolveChart(render('card'), {}, [{ name: 'Count', type: 'long' }]);
    if (chart === undefined) throw new Error('no chart');
    expect(buildChartModel(chart, [{ name: 'Count', type: 'long' }], [[42]]).card).toEqual({
      label: 'Count',
      value: '42',
    });
  });

  it('marks anomalies on anomaly charts', () => {
    const columns: ResultColumn[] = [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'Value', type: 'real' },
      { name: 'Anomalies', type: 'int' },
    ];
    const chart = resolveChart(render('anomalychart', { ycolumns: 'Value' }), {}, columns);
    expect(chart?.anomalyColumn).toBe('Anomalies');
    if (chart === undefined) throw new Error('no chart');
    const model = buildChartModel(chart, columns, [
      ['2026-09-01T00:00:00Z', 1, 0],
      ['2026-09-01T01:00:00Z', 9, 1],
    ]);
    expect(model.series[0]?.anomalies).toEqual([[Date.parse('2026-09-01T01:00:00Z'), 9]]);
  });

  it('downsamples line series above the point limit', () => {
    const columns: ResultColumn[] = [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'Value', type: 'real' },
    ];
    const rows = Array.from({ length: MAX_POINTS + 10_000 }, (_, i) => [
      new Date(i * 1000).toISOString(),
      Math.sin(i / 100),
    ]);
    const chart = resolveChart(render('timechart'), {}, columns);
    if (chart === undefined) throw new Error('no chart');
    const model = buildChartModel(chart, columns, rows);
    expect(model.series[0]?.points).toHaveLength(MAX_POINTS);
    expect(model.notice).toContain('downsampled');
  });
});

describe('toEChartsOption', () => {
  it('produces an option for every chart kind', () => {
    const colors = readChartColors();
    for (const [visualization, type] of [
      ['timechart', 'line'],
      ['columnchart', 'bar'],
      ['barchart', 'bar'],
      ['piechart', 'pie'],
      ['scatterchart', 'scatter'],
      ['areachart', 'line'],
    ] as const) {
      const chart = resolveChart(render(visualization), { x: 'Computer', y: ['count_'] }, COLUMNS);
      if (chart === undefined) throw new Error(visualization);
      const option = toEChartsOption(buildChartModel(chart, COLUMNS, ROWS), chart, colors) as {
        series: { type: string }[];
      };
      expect(option.series[0]?.type).toBe(type);
    }
  });
});

describe('lttb', () => {
  it('keeps first and last points and the requested count', () => {
    const points = Array.from({ length: 1000 }, (_, i) => [i, i % 7] as const);
    const sampled = lttb(points, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toEqual([0, 0]);
    expect(sampled.at(-1)).toEqual([999, 999 % 7]);
    expect(lttb(points.slice(0, 5), 100)).toHaveLength(5);
  });
});
