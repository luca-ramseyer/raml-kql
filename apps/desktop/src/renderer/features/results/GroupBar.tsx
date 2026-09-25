import { AgGridReact } from 'ag-grid-react';
import { useMemo, useState } from 'react';

import { AppError } from '../../../shared/errors';
import type { ResultColumn, RunSnapshot } from '../../../shared/query/models';
import {
  AGGREGATIONS,
  type AggregationFn,
  type GroupSpec,
} from '../../../shared/results/aggregate';
import type { DisplayNames } from '../../../shared/results/display-names';
import { notify } from '../../platform/notifications';
import { useSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';

import { buildColumnDefs, fieldOf, type GridRow } from './grid/column-defs';
import { gridTheme, registerGridModules } from './grid/grid-setup';
import { tabResults, updateTabResults, type GroupedView } from './results-ui';

registerGridModules();

const TENANT_COLUMN = '_TenantName';

/** Run a group-by over the tab's current view (filters and search apply). */
export async function applyGrouping(
  tabId: string,
  run: RunSnapshot,
  tableIndex: number,
  spec: GroupSpec,
  display: DisplayNames | undefined,
): Promise<void> {
  const { view } = tabResults(tabId, run.runId);
  try {
    const result = await unwrap(
      getBridge().results.aggregate({
        runId: run.runId,
        tableIndex,
        view,
        ...(display === undefined ? {} : { display }),
        spec,
      }),
    );
    updateTabResults(tabId, run.runId, {
      grouped: { spec, ...result },
      showGrouped: true,
    });
    if (result.truncated) {
      notify({
        severity: 'warning',
        message: 'More than 100,000 groups: only the first 100,000 are shown.',
        source: 'Results',
      });
    }
  } catch (error) {
    notify({
      severity: 'error',
      message: error instanceof Error ? error.message : 'Grouping failed.',
      detail: error instanceof AppError ? error.detail : undefined,
      source: 'Results',
    });
  }
}

/** "Group by tenant" (spec 06): rows per `_TenantName`. */
export function tenantGroupSpec(columns: readonly ResultColumn[]): GroupSpec | undefined {
  const index = columns.findIndex((c) => c.name === TENANT_COLUMN);
  return index < 0 ? undefined : { groupBy: [index], aggregations: [{ fn: 'count' }] };
}

/**
 * The group bar (spec 06, "Group-by"): choose group columns and aggregations over the merged
 * rows. The result is a derived "Grouped view" with a toggle back to the rows.
 */
export function GroupBar({
  tabId,
  run,
  tableIndex,
  columns,
  display,
  onClose,
}: {
  tabId: string;
  run: RunSnapshot;
  tableIndex: number;
  columns: ResultColumn[];
  display: DisplayNames | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const existing = tabResults(tabId, run.runId).grouped?.spec;
  const [groupBy, setGroupBy] = useState<number[]>(existing?.groupBy ?? []);
  const [aggregations, setAggregations] = useState<GroupSpec['aggregations']>(
    existing?.aggregations ?? [{ fn: 'count' }],
  );
  const preset = tenantGroupSpec(columns);

  const columnOptions = columns.map((c, i) => (
    <option key={c.name} value={i}>
      {c.name}
    </option>
  ));

  return (
    <div className="group-bar" role="group" aria-label="Group by">
      <span className="group-label">Group by</span>
      {groupBy.map((index) => (
        <span key={index} className="group-chip">
          {columns[index]?.name}
          <button
            type="button"
            className="action-item"
            aria-label={`Remove ${columns[index]?.name ?? ''}`}
            onClick={() => {
              setGroupBy(groupBy.filter((g) => g !== index));
            }}
          >
            <Codicon name="close" />
          </button>
        </span>
      ))}
      <select
        className="group-select"
        aria-label="Add group column"
        value=""
        onChange={(event) => {
          const index = Number(event.target.value);
          if (!groupBy.includes(index)) setGroupBy([...groupBy, index]);
        }}
      >
        <option value="" disabled>
          Add column…
        </option>
        {columnOptions}
      </select>
      <span className="group-label">Aggregate</span>
      {aggregations.map((aggregation, i) => (
        <span key={i} className="group-chip">
          <select
            aria-label="Aggregation"
            value={aggregation.fn}
            onChange={(event) => {
              const fn = event.target.value as AggregationFn;
              setAggregations(
                aggregations.map((a, j) =>
                  j === i ? (fn === 'count' ? { fn } : { fn, column: a.column ?? 0 }) : a,
                ),
              );
            }}
          >
            {AGGREGATIONS.map((fn) => (
              <option key={fn} value={fn}>
                {fn}
              </option>
            ))}
          </select>
          {aggregation.fn === 'count' ? null : (
            <select
              aria-label="Aggregated column"
              value={aggregation.column ?? 0}
              onChange={(event) => {
                setAggregations(
                  aggregations.map((a, j) =>
                    j === i ? { ...a, column: Number(event.target.value) } : a,
                  ),
                );
              }}
            >
              {columnOptions}
            </select>
          )}
          {aggregations.length > 1 ? (
            <button
              type="button"
              className="action-item"
              aria-label="Remove aggregation"
              onClick={() => {
                setAggregations(aggregations.filter((_, j) => j !== i));
              }}
            >
              <Codicon name="close" />
            </button>
          ) : null}
        </span>
      ))}
      <button
        type="button"
        className="action-item"
        title="Add Aggregation"
        aria-label="Add aggregation"
        onClick={() => {
          setAggregations([...aggregations, { fn: 'count' }]);
        }}
      >
        <Codicon name="add" />
      </button>
      <button
        type="button"
        className="button button-primary"
        onClick={() =>
          void applyGrouping(tabId, run, tableIndex, { groupBy, aggregations }, display)
        }
      >
        Group
      </button>
      {preset === undefined ? null : (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setGroupBy(preset.groupBy);
            setAggregations(preset.aggregations);
            void applyGrouping(tabId, run, tableIndex, preset, display);
          }}
        >
          Group by Tenant
        </button>
      )}
      <span className="results-bar-spacer" />
      <button
        type="button"
        className="action-item"
        title="Close"
        aria-label="Close group bar"
        onClick={onClose}
      >
        <Codicon name="close" />
      </button>
    </div>
  );
}

/** The grouped view: a small, client-side grid (sorting and filtering in the grid itself). */
export function GroupedGrid({ grouped }: { grouped: GroupedView }): React.JSX.Element {
  const zone = useSetting('time.displayZone');
  const columnDefs = useMemo(
    () =>
      buildColumnDefs(grouped.columns, {
        zone,
        shownAttribution: grouped.columns.map((c) => c.name),
        hidden: new Set(),
      }),
    [grouped.columns, zone],
  );
  const rowData = useMemo<GridRow[]>(
    () =>
      grouped.rows.map((row, i) => {
        const out: GridRow = { __pos: i };
        row.forEach((value, c) => {
          out[fieldOf(c)] = value;
        });
        return out;
      }),
    [grouped.rows],
  );
  return (
    <div className="results-grid" aria-label="Grouped view">
      <AgGridReact<GridRow>
        theme={gridTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        loadThemeGoogleFonts={false}
      />
    </div>
  );
}
