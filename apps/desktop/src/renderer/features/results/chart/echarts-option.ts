import type { EChartsCoreOption } from 'echarts/core';

import type { ChartModel, ResolvedChart } from './chart-model';

/** Workbench colours for charts (spec 06: charts follow the current theme). */
export interface ChartColors {
  foreground: string;
  muted: string;
  grid: string;
  background: string;
  palette: string[];
}

const PALETTE_VARS = [
  '--vscode-charts-blue',
  '--vscode-charts-orange',
  '--vscode-charts-green',
  '--vscode-charts-purple',
  '--vscode-charts-red',
  '--vscode-charts-yellow',
];
const FALLBACK_PALETTE = ['#3794ff', '#d18616', '#89d185', '#b180d7', '#f14c4c', '#cca700'];

export function readChartColors(root: HTMLElement = document.documentElement): ChartColors {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  const palette = PALETTE_VARS.map((name, i) => read(name, FALLBACK_PALETTE[i] ?? '#888'));
  return {
    foreground: read('--vscode-foreground', '#cccccc'),
    muted: read('--vscode-descriptionForeground', '#999999'),
    grid: read('--vscode-panel-border', 'rgba(128,128,128,0.35)'),
    background: read('--vscode-panel-background', read('--vscode-editor-background', '#1e1e1e')),
    // Extra shades so many series (tenants) stay distinguishable.
    palette: [...palette, '#4ec9b0', '#ce9178', '#9cdcfe', '#c586c0', '#dcdcaa', '#569cd6'],
  };
}

export function toEChartsOption(
  model: ChartModel,
  chart: ResolvedChart,
  colors: ChartColors,
): EChartsCoreOption {
  const text = { color: colors.foreground };
  const axisLine = { lineStyle: { color: colors.grid } };
  const splitLine = { lineStyle: { color: colors.grid, type: 'dashed' as const } };
  const base = {
    color: colors.palette,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'inherit', ...text },
    animation: model.series.reduce((n, s) => n + s.points.length, 0) < 5000,
    title:
      chart.title === undefined
        ? undefined
        : { text: chart.title, left: 'center', textStyle: { ...text, fontSize: 13 } },
    tooltip: { trigger: model.kind === 'pie' ? 'item' : 'axis', confine: true },
    legend:
      chart.legend && model.series.length > 1
        ? { type: 'scroll', bottom: 0, textStyle: { color: colors.muted } }
        : undefined,
  };

  if (model.kind === 'pie') {
    const first = model.series[0];
    return {
      ...base,
      legend: chart.legend
        ? { type: 'scroll', bottom: 0, textStyle: { color: colors.muted } }
        : undefined,
      series: [
        {
          type: 'pie',
          radius: ['35%', '70%'],
          itemStyle: { borderColor: colors.background, borderWidth: 1 },
          label: { color: colors.foreground },
          data: (first?.points ?? []).map(([name, value]) => ({ name: String(name), value })),
        },
      ],
    };
  }

  const horizontal = model.kind === 'bar';
  const categoryAxis = {
    type: model.xType,
    name: chart.xTitle,
    nameTextStyle: { color: colors.muted },
    axisLabel: { color: colors.muted, hideOverlap: true },
    axisLine,
    ...(model.xType === 'category'
      ? { data: [...new Set(model.series.flatMap((s) => s.points.map((p) => String(p[0]))))] }
      : {}),
  };
  const valueAxis = {
    type: 'value' as const,
    name: chart.yTitle,
    nameTextStyle: { color: colors.muted },
    min: chart.yMin,
    max: chart.yMax,
    axisLabel: { color: colors.muted },
    axisLine,
    splitLine,
  };
  const stacked = model.kind === 'stackedArea';
  return {
    ...base,
    grid: {
      left: 56,
      right: 24,
      top: chart.title === undefined ? 24 : 40,
      bottom: base.legend === undefined ? 48 : 72,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    dataZoom: model.xType === 'category' ? undefined : [{ type: 'inside' }],
    series: model.series.map((s) => ({
      name: s.name,
      type:
        model.kind === 'column' || model.kind === 'bar'
          ? 'bar'
          : model.kind === 'scatter'
            ? 'scatter'
            : 'line',
      data: horizontal ? s.points.map(([x, y]) => [y, x]) : s.points,
      showSymbol: model.kind === 'scatter' || s.points.length < 60,
      symbolSize: model.kind === 'scatter' ? 6 : 4,
      sampling: model.kind === 'line' ? 'lttb' : undefined,
      ...(model.kind === 'area' || stacked ? { areaStyle: { opacity: 0.3 } } : {}),
      ...(stacked ? { stack: 'total' } : {}),
      ...(s.anomalies === undefined
        ? {}
        : {
            markPoint: {
              symbol: 'circle',
              symbolSize: 8,
              itemStyle: { color: colors.palette[4] },
              data: s.anomalies.map(([x, y]) => ({ coord: [x, y] })),
            },
          }),
    })),
  };
}
