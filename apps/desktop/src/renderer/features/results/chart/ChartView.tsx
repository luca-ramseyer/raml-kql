import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ResultColumn } from '../../../../shared/query/models';
import type { ChartData } from '../../../../shared/results/requests';
import { notify } from '../../../platform/notifications';
import { useTheme } from '../../../platform/theme/theme-service';
import { getBridge, unwrap } from '../../../services/ipc';
import { Codicon } from '../../../workbench/common/Codicon';
import { useAccounts } from '../../accounts/accounts-store';
import { useNamer } from '../../privacy/privacy';
import { useInventory } from '../../workspaces/inventory-store';
import { useActiveRun } from '../active-run';
import { buildDisplayNames } from '../display-names';
import { updateTabResults, useTabResults, type ChartKind, type ChartSettings } from '../results-ui';

import { buildChartModel, resolveChart, TENANT_COLUMN } from './chart-model';
import { readChartColors, toEChartsOption } from './echarts-option';

import './ChartView.css';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkPointComponent,
  CanvasRenderer,
  SVGRenderer,
]);

const KINDS: { id: ChartKind; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'stackedArea', label: 'Stacked area' },
  { id: 'column', label: 'Column' },
  { id: 'bar', label: 'Bar' },
  { id: 'pie', label: 'Pie' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'card', label: 'Card' },
];
const AGGREGATIONS: NonNullable<ChartSettings['aggregation']>[] = [
  'none',
  'sum',
  'avg',
  'count',
  'min',
  'max',
];

function report(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    source: 'Chart',
  });
}

/**
 * The Chart tab (spec 06): the query's `render` spec, or the chart builder; for the rows or the
 * grouped view. Legends use the names on screen (aliasing), colours follow the theme.
 */
export function ChartView(): React.JSX.Element {
  const { tabId, run } = useActiveRun();
  const ui = useTabResults(tabId, run?.runId);
  const namer = useNamer();
  const workspaces = useInventory((s) => s.inventory.workspaces);
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const theme = useTheme((s) => s.active);
  const display = useMemo(
    () => buildDisplayNames(namer, workspaces, accounts),
    [namer, workspaces, accounts],
  );
  const [data, setData] = useState<ChartData | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | undefined>(undefined);

  const grouped = ui.chart.fromGrouped === true ? ui.grouped : undefined;
  const table = run?.tables.find((t) => t.index === ui.tableIndex) ?? run?.tables[0];
  const columns = useMemo<ResultColumn[]>(
    () => grouped?.columns ?? table?.columns ?? [],
    [grouped, table],
  );
  const resolved =
    run === undefined
      ? undefined
      : resolveChart(grouped === undefined ? run.render : undefined, ui.chart, columns);

  // Fetch only the columns the chart uses.
  const needed = useMemo(() => {
    if (resolved === undefined || grouped !== undefined) return [];
    const names = new Set([resolved.x, ...resolved.y, resolved.series, resolved.anomalyColumn]);
    if (resolved.splitByTenant) names.add(TENANT_COLUMN);
    return columns.flatMap((c, i) => (names.has(c.name) ? [i] : []));
  }, [resolved, grouped, columns]);
  const neededKey = needed.join(',');
  const viewKey = JSON.stringify(ui.view);
  const displayKey = JSON.stringify(display ?? null);
  const rowCount = table?.rowCount ?? 0;

  useEffect(() => {
    if (run === undefined || table === undefined || needed.length === 0) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      void unwrap(
        getBridge().results.chartData({
          runId: run.runId,
          tableIndex: table.index,
          view: ui.view,
          ...(display === undefined ? {} : { display }),
          columns: needed,
        }),
      )
        .then((result) => {
          if (current) setData(result);
        })
        .catch((error: unknown) => {
          report(error, 'Chart data could not be loaded.');
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the objects
  }, [run?.runId, table?.index, neededKey, viewKey, displayKey, rowCount]);

  const model = useMemo(() => {
    if (resolved === undefined) return undefined;
    if (grouped !== undefined) return buildChartModel(resolved, grouped.columns, grouped.rows);
    if (data === undefined) return undefined;
    return buildChartModel(resolved, data.columns, data.rows);
  }, [resolved, grouped, data]);

  // Draw (and redraw on theme changes).
  useEffect(() => {
    const element = container.current;
    if (
      element === null ||
      model === undefined ||
      resolved === undefined ||
      model.kind === 'card'
    ) {
      return undefined;
    }
    const chart = instance.current ?? echarts.init(element, undefined, { renderer: 'canvas' });
    instance.current = chart;
    chart.setOption(toEChartsOption(model, resolved, readChartColors()), true);
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [model, resolved, theme]);

  useEffect(
    () => () => {
      instance.current?.dispose();
      instance.current = undefined;
    },
    [],
  );

  if (run === undefined || tabId === undefined) {
    return (
      <p className="panel-empty">
        Queries that use the render operator, or charts you build from results, appear here.
      </p>
    );
  }

  const set = (patch: Partial<ChartSettings>): void => {
    updateTabResults(tabId, run.runId, (state) => ({ chart: { ...state.chart, ...patch } }));
  };
  const columnOptions = columns.map((c) => (
    <option key={c.name} value={c.name}>
      {c.name}
    </option>
  ));

  const exportImage = async (format: 'png' | 'svg' | 'copy'): Promise<void> => {
    const chart = instance.current;
    if (chart === undefined || model === undefined || resolved === undefined) return;
    try {
      if (format === 'svg') {
        const { width, height } = container.current?.getBoundingClientRect() ?? {
          width: 800,
          height: 400,
        };
        const svg = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width, height });
        svg.setOption({ ...toEChartsOption(model, resolved, readChartColors()), animation: false });
        const markup = svg.renderToSVGString();
        svg.dispose();
        await unwrap(getBridge().results.saveImage({ format: 'svg', data: markup }));
        return;
      }
      const dataUrl = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: readChartColors().background,
      });
      if (format === 'copy') {
        await unwrap(getBridge().shell.writeClipboardImage({ dataUrl }));
        notify({ severity: 'info', message: 'Chart copied as an image.', source: 'Chart' });
      } else {
        await unwrap(getBridge().results.saveImage({ format: 'png', data: dataUrl }));
      }
    } catch (error) {
      report(error, 'The chart could not be exported.');
    }
  };

  return (
    <div className="chart-view">
      <div className="chart-builder" role="toolbar" aria-label="Chart builder">
        <label>
          Chart
          <select
            aria-label="Chart type"
            value={ui.chart.kind ?? ''}
            onChange={(event) => {
              set({
                kind: event.target.value === '' ? undefined : (event.target.value as ChartKind),
              });
            }}
          >
            <option value="">
              {run.render === undefined ? 'None' : `From query (${run.render.visualization})`}
            </option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {resolved === undefined ? null : (
          <>
            <label>
              X
              <select
                aria-label="X column"
                value={resolved.x ?? ''}
                onChange={(event) => {
                  set({ x: event.target.value });
                }}
              >
                {columnOptions}
              </select>
            </label>
            <label>
              Y
              <select
                aria-label="Y column"
                value={resolved.y[0] ?? ''}
                onChange={(event) => {
                  set({ y: [event.target.value] });
                }}
              >
                {columnOptions}
              </select>
            </label>
            <label>
              Series
              <select
                aria-label="Series column"
                value={resolved.series ?? ''}
                onChange={(event) => {
                  set({ series: event.target.value === '' ? undefined : event.target.value });
                }}
              >
                <option value="">None</option>
                {columnOptions}
              </select>
            </label>
            <label>
              Aggregation
              <select
                aria-label="Aggregation"
                value={resolved.aggregation}
                onChange={(event) => {
                  set({ aggregation: event.target.value as ChartSettings['aggregation'] });
                }}
              >
                {AGGREGATIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            {columns.some((c) => c.name === TENANT_COLUMN) ? (
              <label className="chart-check">
                <input
                  type="checkbox"
                  checked={resolved.splitByTenant}
                  onChange={(event) => {
                    set({ splitByTenant: event.target.checked });
                  }}
                />
                Split by tenant
              </label>
            ) : null}
          </>
        )}
        {ui.grouped === undefined ? null : (
          <label className="chart-check">
            <input
              type="checkbox"
              checked={ui.chart.fromGrouped === true}
              onChange={(event) => {
                set({ fromGrouped: event.target.checked });
              }}
            />
            Grouped view
          </label>
        )}
        <span className="results-bar-spacer" />
        {model === undefined || model.kind === 'card' ? null : (
          <>
            <button
              type="button"
              className="action-item"
              title="Copy Chart as Image"
              aria-label="Copy chart as image"
              onClick={() => void exportImage('copy')}
            >
              <Codicon name="copy" />
            </button>
            <button
              type="button"
              className="action-item"
              title="Save as PNG"
              aria-label="Save chart as PNG"
              onClick={() => void exportImage('png')}
            >
              <Codicon name="file-media" />
            </button>
            <button
              type="button"
              className="action-item"
              title="Save as SVG"
              aria-label="Save chart as SVG"
              onClick={() => void exportImage('svg')}
            >
              <Codicon name="symbol-misc" />
            </button>
          </>
        )}
      </div>
      {model?.notice === undefined && data?.truncated !== true ? null : (
        <div className="results-banner" role="status">
          <Codicon name="info" />
          {data?.truncated === true ? ' The chart shows the first 200,000 rows.' : ''}{' '}
          {model?.notice ?? ''}
        </div>
      )}
      {resolved === undefined ? (
        <p className="panel-empty">
          This query has no chart. Choose a chart type above, or add a render operator (e.g. `|
          render timechart`).
        </p>
      ) : model?.kind === 'card' ? (
        <div className="chart-card" aria-label="Card">
          <div className="chart-card-value">{model.card?.value}</div>
          <div className="chart-card-label">{model.card?.label}</div>
        </div>
      ) : (
        <div className="chart-canvas" ref={container} aria-label="Chart" role="img" />
      )}
    </div>
  );
}
