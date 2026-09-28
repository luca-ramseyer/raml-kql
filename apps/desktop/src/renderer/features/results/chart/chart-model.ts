import type { RenderSpec, ResultColumn } from '../../../../shared/query/models';
import {
  dateValue,
  isNumericType,
  numberValue,
  valueText,
} from '../../../../shared/results/values';
import type { ChartKind, ChartSettings } from '../results-ui';

import { lttb } from './lttb';

/**
 * Charts (spec 06): Log Analytics `render` kinds mapped to chart settings, and chart settings
 * turned into a renderer-independent chart model (series of points) that the ECharts adapter
 * draws. Pure, so every render type is unit-tested.
 */

export const MAX_POINTS = 50_000;
export const TENANT_COLUMN = '_TenantName';

export interface ResolvedChart {
  kind: ChartKind;
  x: string | undefined;
  y: string[];
  series: string | undefined;
  aggregation: NonNullable<ChartSettings['aggregation']>;
  splitByTenant: boolean;
  title?: string | undefined;
  xTitle?: string | undefined;
  yTitle?: string | undefined;
  yMin?: number | undefined;
  yMax?: number | undefined;
  legend: boolean;
  /** anomalychart: a column flagging anomalies. */
  anomalyColumn?: string | undefined;
}

const RENDER_KINDS: Record<string, ChartKind | 'table' | 'anomaly'> = {
  timechart: 'line',
  linechart: 'line',
  areachart: 'area',
  stackedareachart: 'stackedArea',
  columnchart: 'column',
  barchart: 'bar',
  piechart: 'pie',
  scatterchart: 'scatter',
  anomalychart: 'anomaly',
  card: 'card',
  table: 'table',
};

function prop(render: RenderSpec | undefined, name: string): unknown {
  return render?.properties?.[name];
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => valueText(v)).filter((v) => v !== '');
  if (typeof value === 'string' && value.trim() !== '')
    return value.split(',').map((v) => v.trim());
  return undefined;
}

/**
 * The chart to draw: the user's builder settings on top of the query's `render` spec, with
 * Kusto's defaults for anything neither names (x = first column, or the first datetime for
 * time charts; y = numeric columns; series = string columns for time and line charts).
 */
export function resolveChart(
  render: RenderSpec | undefined,
  settings: ChartSettings,
  columns: readonly ResultColumn[],
): ResolvedChart | undefined {
  const mapped =
    render === undefined ? undefined : RENDER_KINDS[render.visualization.toLowerCase()];
  if (settings.kind === undefined && (mapped === undefined || mapped === 'table')) return undefined;
  const renderKind = prop(render, 'kind');
  let kind: ChartKind =
    settings.kind ??
    (mapped === 'anomaly' ? 'line' : ((mapped as ChartKind | undefined) ?? 'column'));
  if (
    settings.kind === undefined &&
    kind === 'area' &&
    typeof renderKind === 'string' &&
    /stacked/i.test(renderKind)
  ) {
    kind = 'stackedArea';
  }
  const dataColumns = columns.filter((c) => c.attribution !== true);
  const isTime =
    settings.kind === undefined && (render?.visualization === 'timechart' || mapped === 'anomaly');
  const renderX =
    typeof prop(render, 'xcolumn') === 'string' ? (prop(render, 'xcolumn') as string) : undefined;
  const x =
    settings.x ??
    renderX ??
    (isTime ? dataColumns.find((c) => c.type === 'datetime')?.name : undefined) ??
    dataColumns[0]?.name;
  const renderY = stringList(prop(render, 'ycolumns'));
  const y =
    settings.y ??
    renderY ??
    dataColumns.filter((c) => c.name !== x && isNumericType(c.type)).map((c) => c.name);
  const renderSeries = stringList(prop(render, 'series'));
  const implicitSeries =
    kind === 'line' ||
    kind === 'area' ||
    kind === 'stackedArea' ||
    kind === 'column' ||
    kind === 'bar'
      ? dataColumns.find((c) => c.name !== x && c.type === 'string' && !y.includes(c.name))?.name
      : undefined;
  const series =
    settings.series ?? renderSeries?.[0] ?? (render === undefined ? undefined : implicitSeries);
  const tenants = columns.some((c) => c.name === TENANT_COLUMN);
  const splitByTenant =
    settings.splitByTenant ??
    (tenants &&
      series === undefined &&
      renderSeries === undefined &&
      kind !== 'pie' &&
      kind !== 'card');
  const number = (name: string): number | undefined => {
    const n = numberValue(prop(render, name));
    return n === null ? undefined : n;
  };
  return {
    kind,
    x,
    y,
    series,
    aggregation: settings.aggregation ?? 'none',
    splitByTenant: tenants && splitByTenant,
    title:
      typeof prop(render, 'title') === 'string' ? (prop(render, 'title') as string) : undefined,
    xTitle:
      typeof prop(render, 'xtitle') === 'string' ? (prop(render, 'xtitle') as string) : undefined,
    yTitle:
      typeof prop(render, 'ytitle') === 'string' ? (prop(render, 'ytitle') as string) : undefined,
    yMin: number('ymin'),
    yMax: number('ymax'),
    legend: prop(render, 'legend') !== 'hidden',
    anomalyColumn:
      mapped === 'anomaly'
        ? columns.find((c) => /anomal/i.test(c.name) && c.name !== x && !y.includes(c.name))?.name
        : undefined,
  };
}

export interface ChartSeries {
  name: string;
  /** [x, y] points; x is a number (time or value) or a category label. */
  points: [number | string, number | null][];
  anomalies?: [number | string, number][];
}

export interface ChartModel {
  kind: ChartKind;
  xType: 'time' | 'value' | 'category';
  series: ChartSeries[];
  /** Card: the value to show big. */
  card?: { label: string; value: string } | undefined;
  notice?: string | undefined;
}

type Aggregation = ResolvedChart['aggregation'];

function aggregate(values: number[], fn: Aggregation): number | null {
  if (values.length === 0) return fn === 'count' ? 0 : null;
  switch (fn) {
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

export function buildChartModel(
  chart: ResolvedChart,
  columns: readonly ResultColumn[],
  rows: readonly (readonly unknown[])[],
): ChartModel {
  const at = (name: string | undefined): number =>
    name === undefined ? -1 : columns.findIndex((c) => c.name === name);
  const xi = at(chart.x);
  const xColumn = columns[xi];
  const si = at(chart.series);
  const ti = chart.splitByTenant ? at(TENANT_COLUMN) : -1;
  const ai = at(chart.anomalyColumn);
  const yIndexes = chart.y.map(at).filter((i) => i >= 0);

  if (chart.kind === 'card') {
    const yi = yIndexes[0] ?? columns.findIndex((c) => isNumericType(c.type));
    const first = rows[0];
    return {
      kind: 'card',
      xType: 'category',
      series: [],
      card: {
        label: columns[yi]?.name ?? '',
        value: first === undefined ? '—' : valueText(first[yi]),
      },
    };
  }

  const xType: ChartModel['xType'] =
    xColumn?.type === 'datetime'
      ? 'time'
      : xColumn !== undefined &&
          isNumericType(xColumn.type) &&
          chart.kind !== 'column' &&
          chart.kind !== 'bar'
        ? 'value'
        : 'category';
  const xValue = (value: unknown): number | string | null => {
    if (xType === 'time') return dateValue(value);
    if (xType === 'value') return numberValue(value);
    return valueText(value);
  };

  // Group rows into series: y column × series value × tenant.
  const groups = new Map<string, Map<number | string, number[]>>();
  const anomalies = new Map<string, [number | string, number][]>();
  const order: string[] = [];
  for (const row of rows) {
    const xv = xi < 0 ? '' : xValue(row[xi]);
    if (xv === null) continue;
    const prefix = [
      ti >= 0 ? valueText(row[ti]) : undefined,
      si >= 0 ? valueText(row[si]) : undefined,
    ].filter((p): p is string => p !== undefined && p !== '');
    for (const yi of yIndexes) {
      const yName = columns[yi]?.name ?? '';
      const name =
        [...prefix, ...(yIndexes.length > 1 || prefix.length === 0 ? [yName] : [])].join(' · ') ||
        yName;
      let points = groups.get(name);
      if (points === undefined) {
        points = new Map();
        groups.set(name, points);
        order.push(name);
      }
      const y = numberValue(row[yi]);
      const bucket = points.get(xv) ?? [];
      if (y !== null) bucket.push(y);
      points.set(xv, bucket);
      if (ai >= 0 && y !== null && (numberValue(row[ai]) ?? 0) !== 0) {
        const list = anomalies.get(name) ?? [];
        list.push([xv, y]);
        anomalies.set(name, list);
      }
    }
  }

  let notice: string | undefined;
  const fn: Aggregation = chart.aggregation === 'none' ? 'sum' : chart.aggregation;
  const series: ChartSeries[] = order.map((name) => {
    const buckets = groups.get(name) ?? new Map<number | string, number[]>();
    let points: [number | string, number | null][] = [...buckets.entries()].map(([xv, ys]) => [
      xv,
      // Without an aggregation, several rows at the same x are summed (like the portal).
      aggregate(ys, fn),
    ]);
    if (xType !== 'category') points.sort((p, q) => Number(p[0]) - Number(q[0]));
    const isLine = chart.kind === 'line' || chart.kind === 'area' || chart.kind === 'stackedArea';
    if (isLine && xType !== 'category' && points.length > MAX_POINTS) {
      const numeric = points.filter((p): p is [number, number] => p[1] !== null);
      points = lttb(numeric, MAX_POINTS);
      notice = `Some series had more than ${MAX_POINTS.toLocaleString()} points and were downsampled (LTTB).`;
    }
    const anomalyPoints = anomalies.get(name);
    return { name, points, ...(anomalyPoints === undefined ? {} : { anomalies: anomalyPoints }) };
  });
  return { kind: chart.kind, xType, series, notice };
}
