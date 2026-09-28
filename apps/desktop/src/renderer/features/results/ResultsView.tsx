import { useEffect, useMemo, useState } from 'react';

import { showPanelTab } from '../../platform/layout';
import { useSetting } from '../../platform/settings';
import { Codicon } from '../../workbench/common/Codicon';
import { useAccounts } from '../accounts/accounts-store';
import { useNamer } from '../privacy/privacy';
import { runSummaryText } from '../query/run-store';
import { useInventory } from '../workspaces/inventory-store';

import { useActiveRun } from './active-run';
import { ColumnPicker, isColumnShown } from './ColumnPicker';
import { DetailsSheet } from './DetailsSheet';
import { buildDisplayNames } from './display-names';
import { formatCell } from './grid/cell-format';
import { ResultsGrid } from './grid/ResultsGrid';
import { GroupBar, GroupedGrid } from './GroupBar';
import { exportResults } from './result-actions';
import { updateTabResults, useTabResults } from './results-ui';

import './results.css';

/**
 * Merged results of the active tab (spec 06): result table tabs, quick search, group-by,
 * column picker, export, the grid and the details sheet.
 */
export function ResultsView(): React.JSX.Element {
  const { tabId, run } = useActiveRun();
  const ui = useTabResults(tabId, run?.runId);
  const namer = useNamer();
  const workspaces = useInventory((s) => s.inventory.workspaces);
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const shownAttribution = useSetting('results.attributionColumns');
  const zone = useSetting('time.displayZone');
  const [search, setSearch] = useState(ui.view.quickSearch);
  const [groupBarOpen, setGroupBarOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const display = useMemo(
    () => buildDisplayNames(namer, workspaces, accounts),
    [namer, workspaces, accounts],
  );

  // Debounced quick search (spec 06, "global quick-search box").
  const runId = run?.runId;
  useEffect(() => {
    if (tabId === undefined || runId === undefined) return undefined;
    const timer = setTimeout(() => {
      updateTabResults(tabId, runId, (state) => ({ view: { ...state.view, quickSearch: search } }));
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [search, tabId, runId]);

  if (run === undefined || tabId === undefined) {
    return (
      <p className="panel-empty">Run a query to see merged results from all selected workspaces.</p>
    );
  }
  const table = run.tables.find((t) => t.index === ui.tableIndex) ?? run.tables[0];
  const columns = table?.columns ?? [];
  const rowCount = table?.rowCount ?? 0;
  const shownNames = columns
    .filter((c) => c.attribution === true && isColumnShown(c, ui.columnOverrides, shownAttribution))
    .map((c) => c.name);
  const hidden = new Set(
    columns
      .filter(
        (c) => c.attribution !== true && !isColumnShown(c, ui.columnOverrides, shownAttribution),
      )
      .map((c) => c.name),
  );
  const visibleColumns = columns.flatMap((c, i) =>
    isColumnShown(c, ui.columnOverrides, shownAttribution) ? [i] : [],
  );
  const filtered = ui.filteredRows ?? rowCount;
  const showGrouped = ui.showGrouped && ui.grouped !== undefined;
  const exportContext = {
    run,
    tabId,
    visibleColumns,
    grouped: showGrouped ? ui.grouped : undefined,
  };

  return (
    <div className="results-view">
      <div className="results-bar">
        <button
          type="button"
          className="run-pill"
          title="Show per-workspace status"
          onClick={() => {
            showPanelTab('run');
          }}
        >
          {run.state === 'running' ? (
            <Codicon name="loading" className="codicon-modifier-spin" />
          ) : null}
          {runSummaryText(run)}
        </button>
        {run.tables.length > 1 ? (
          <div className="results-tables" role="tablist" aria-label="Result tables">
            {run.tables.map((t) => (
              <button
                key={t.index}
                type="button"
                role="tab"
                aria-selected={t.index === table?.index}
                className={`results-table-tab${t.index === table?.index ? ' checked' : ''}`}
                onClick={() => {
                  updateTabResults(tabId, run.runId, {
                    tableIndex: t.index,
                    view: { ...ui.view, sort: [], filters: {}, valueFilters: [] },
                    grouped: undefined,
                    showGrouped: false,
                    selected: [],
                    details: undefined,
                  });
                }}
              >
                {`Table ${String(t.index + 1)}`}
              </button>
            ))}
          </div>
        ) : null}
        <input
          type="search"
          className="results-search"
          placeholder="Search results"
          aria-label="Search results"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        {ui.view.valueFilters.map((filter, i) => (
          <span key={`${String(filter.column)}-${String(i)}`} className="value-filter-chip">
            {columns[filter.column]?.name} {filter.mode === 'include' ? '=' : '≠'}{' '}
            {formatCell(filter.values[0], columns[filter.column]?.type ?? 'string', zone) ||
              '(empty)'}
            <button
              type="button"
              className="action-item"
              aria-label="Remove filter"
              onClick={() => {
                updateTabResults(tabId, run.runId, (state) => ({
                  view: {
                    ...state.view,
                    valueFilters: state.view.valueFilters.filter((_, j) => j !== i),
                  },
                }));
              }}
            >
              <Codicon name="close" />
            </button>
          </span>
        ))}
        <div className="results-actions" role="toolbar" aria-label="Results actions">
          <button
            type="button"
            className={`action-item${groupBarOpen ? ' checked' : ''}`}
            title="Group"
            aria-label="Group"
            aria-pressed={groupBarOpen}
            onClick={() => {
              setGroupBarOpen(!groupBarOpen);
            }}
          >
            <Codicon name="group-by-ref-type" />
          </button>
          {ui.grouped === undefined ? null : (
            <button
              type="button"
              className="action-item"
              title={showGrouped ? 'Show Rows' : 'Show Grouped View'}
              aria-label={showGrouped ? 'Show rows' : 'Show grouped view'}
              onClick={() => {
                updateTabResults(tabId, run.runId, { showGrouped: !showGrouped });
              }}
            >
              <Codicon name={showGrouped ? 'list-flat' : 'list-tree'} />
            </button>
          )}
          <span className="column-picker-anchor">
            <button
              type="button"
              className="action-item"
              title="Choose Columns"
              aria-label="Choose columns"
              onClick={() => {
                setPickerOpen(!pickerOpen);
              }}
            >
              <Codicon name="list-selection" />
            </button>
            {pickerOpen ? (
              <ColumnPicker
                columns={columns}
                overrides={ui.columnOverrides}
                shownAttribution={shownAttribution}
                onChange={(name, shown) => {
                  updateTabResults(tabId, run.runId, (state) => ({
                    columnOverrides: { ...state.columnOverrides, [name]: shown },
                  }));
                }}
                onClose={() => {
                  setPickerOpen(false);
                }}
              />
            ) : null}
          </span>
          <button
            type="button"
            className="action-item"
            title="Copy Results As…"
            aria-label="Copy results as"
            onClick={() => void exportResults(exportContext, 'clipboard')}
          >
            <Codicon name="copy" />
          </button>
          <button
            type="button"
            className="action-item"
            title="Export Results…"
            aria-label="Export results"
            onClick={() => void exportResults(exportContext, 'file')}
          >
            <Codicon name="desktop-download" />
          </button>
        </div>
        <span className="results-bar-spacer" />
        {run.demo ? (
          <span className="demo-badge" title="These rows were generated by demo mode, not queried.">
            <Codicon name="beaker" /> Demo data
          </span>
        ) : null}
        <span className="results-count" role="status">
          {showGrouped
            ? `${(ui.grouped?.rows.length ?? 0).toLocaleString()} group${ui.grouped?.rows.length === 1 ? '' : 's'}`
            : filtered === rowCount
              ? `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}`
              : `${filtered.toLocaleString()} of ${rowCount.toLocaleString()} rows`}
          {ui.selected.length > 0 ? ` · ${ui.selected.length.toLocaleString()} selected` : ''}
        </span>
      </div>
      {run.truncated ? (
        <div className="results-banner" role="alert">
          <Codicon name="warning" /> Result truncated at {rowCount.toLocaleString()} rows — narrow
          your query or reduce targets.
        </div>
      ) : null}
      {groupBarOpen && table !== undefined ? (
        <GroupBar
          tabId={tabId}
          run={run}
          tableIndex={table.index}
          columns={columns}
          display={display}
          onClose={() => {
            setGroupBarOpen(false);
          }}
        />
      ) : null}
      {table === undefined ? (
        <p className="panel-empty">
          {run.state === 'running' ? 'Waiting for the first workspace…' : 'No results.'}
        </p>
      ) : (
        <div className="results-body">
          {showGrouped && ui.grouped !== undefined ? (
            <GroupedGrid grouped={ui.grouped} />
          ) : (
            <ResultsGrid
              key={`${run.runId}-${String(table.index)}`}
              run={run}
              tabId={tabId}
              tableIndex={table.index}
              columns={columns}
              rowCount={rowCount}
              display={display}
              hiddenColumns={hidden}
              shownAttribution={shownNames}
            />
          )}
          {ui.details === undefined || showGrouped ? null : (
            <DetailsSheet
              runId={run.runId}
              tableIndex={table.index}
              columns={columns}
              display={display}
              details={ui.details}
              onClose={() => {
                updateTabResults(tabId, run.runId, { details: undefined });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
