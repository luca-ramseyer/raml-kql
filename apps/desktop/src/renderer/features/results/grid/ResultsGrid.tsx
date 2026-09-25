import type {
  CellContextMenuEvent,
  CellDoubleClickedEvent,
  CellKeyDownEvent,
  ColDef,
  FilterChangedEvent,
  GridApi,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  SortChangedEvent,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { rowLinks } from '../../../../shared/links/row-links';
import type { ResultColumn, RunSnapshot } from '../../../../shared/query/models';
import type { DisplayNames } from '../../../../shared/results/display-names';
import { valueText } from '../../../../shared/results/values';
import type { ViewState } from '../../../../shared/results/view';
import { useSetting } from '../../../platform/settings';
import { getBridge, unwrap } from '../../../services/ipc';
import { ContextMenu, type MenuEntry } from '../../../workbench/common/ContextMenu';
import { extensionCellMenu, overlayColumnDefs, useEnrichment } from '../../extensions/enrichment';
import {
  appendWhere,
  copyText,
  openInPortal,
  openUrl,
  workspaceByCustomerId,
} from '../result-actions';
import { updateTabResults, useTabResults } from '../results-ui';

import { formatCell, toTsv } from './cell-format';
import { buildColumnDefs, fieldOf, viewFromGrid, type GridRow } from './column-defs';
import { gridTheme, registerGridModules } from './grid-setup';

import './ResultsGrid.css';

registerGridModules();

const BLOCK_SIZE = 200;

interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

function toGridRows(rows: readonly unknown[][], positions: readonly number[]): GridRow[] {
  return rows.map((row, i) => {
    const out: GridRow = { __pos: positions[i] ?? i };
    row.forEach((value, c) => {
      out[fieldOf(c)] = value;
    });
    return out;
  });
}

function rowValues(data: GridRow | undefined, columns: readonly ResultColumn[]): unknown[] {
  return columns.map((_, i) => data?.[fieldOf(i)] ?? null);
}

/**
 * The results grid (spec 06): AG Grid's infinite row model over the main-process result store.
 * Sorting, filtering and quick search run in the main process next to the data; the grid holds
 * only the blocks of rows on screen, so a 1M-row result scrolls like a 100-row one.
 */
export function ResultsGrid({
  run,
  tabId,
  tableIndex,
  columns,
  rowCount,
  display,
  hiddenColumns,
  shownAttribution,
}: {
  run: RunSnapshot;
  tabId: string;
  tableIndex: number;
  columns: ResultColumn[];
  rowCount: number;
  display: DisplayNames | undefined;
  hiddenColumns: ReadonlySet<string>;
  /** Attribution columns to show (setting, overridden by the column picker). */
  shownAttribution: readonly string[];
}): React.JSX.Element {
  const zone = useSetting('time.displayZone');
  const copyWithHeaders = useSetting('results.copyWithHeaders');
  const cellFilterMode = useSetting('results.cellFilterMode');
  const linksEnabled = useSetting('links.enabled');
  const ui = useTabResults(tabId, run.runId);
  const apiRef = useRef<GridApi<GridRow> | undefined>(undefined);
  const [menu, setMenu] = useState<MenuState | undefined>(undefined);

  // The datasource reads the latest state through refs, so it's created once per table.
  const displayRef = useRef(display);
  const viewRef = useRef<Pick<ViewState, 'quickSearch' | 'valueFilters'>>(ui.view);
  useLayoutEffect(() => {
    displayRef.current = display;
    viewRef.current = ui.view;
  });

  const overlays = useEnrichment((s) => s.byRun[run.runId]);
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      ...buildColumnDefs(columns, { zone, shownAttribution, hidden: hiddenColumns }),
      ...overlayColumnDefs(overlays ?? [], fieldOf),
    ],
    [columns, zone, shownAttribution, hiddenColumns, overlays],
  );

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: (params: IGetRowsParams) => {
        const view = viewFromGrid(
          params.sortModel,
          params.filterModel as Record<string, unknown>,
          viewRef.current,
        );
        updateTabResults(tabId, run.runId, { view });
        void unwrap(
          getBridge().results.view({
            runId: run.runId,
            tableIndex,
            view,
            ...(displayRef.current === undefined ? {} : { display: displayRef.current }),
            offset: params.startRow,
            limit: params.endRow - params.startRow,
          }),
        )
          .then((page) => {
            updateTabResults(tabId, run.runId, { filteredRows: page.rowCount });
            params.successCallback(toGridRows(page.rows, page.positions), page.rowCount);
          })
          .catch(() => {
            params.failCallback();
          });
      },
    }),
    [run.runId, tabId, tableIndex],
  );

  // New rows streamed in, names changed (presentation mode) or search changed: reload blocks.
  const displayKey = JSON.stringify(display ?? null);
  const searchKey = JSON.stringify([ui.view.quickSearch, ui.view.valueFilters]);
  useEffect(() => {
    apiRef.current?.refreshInfiniteCache();
  }, [rowCount, displayKey]);
  useEffect(() => {
    apiRef.current?.purgeInfiniteCache();
  }, [searchKey]);

  const onGridReady = useCallback((event: GridReadyEvent<GridRow>) => {
    apiRef.current = event.api;
  }, []);

  const onSelectionChanged = useCallback(() => {
    const api = apiRef.current;
    if (api === undefined) return;
    const selected = api
      .getSelectedNodes()
      .flatMap((node) => (node.data === undefined ? [] : [node.data.__pos]));
    updateTabResults(tabId, run.runId, { selected });
  }, [tabId, run.runId]);

  const onViewChanged = useCallback(
    (_event: SortChangedEvent<GridRow> | FilterChangedEvent<GridRow>) => {
      apiRef.current?.deselectAll();
    },
    [],
  );

  const showRow = useCallback(
    (position: number) => {
      updateTabResults(tabId, run.runId, { details: { kind: 'row', position } });
    },
    [tabId, run.runId],
  );

  const copySelection = useCallback(() => {
    const api = apiRef.current;
    if (api === undefined) return;
    const visible = api.getAllDisplayedColumns();
    const indexes = visible.map((c) => Number(c.getColId().slice(1)));
    const selected = api.getSelectedNodes().filter((n) => n.data !== undefined);
    if (selected.length > 0) {
      const rows = selected.map((node) =>
        indexes.map((i) => formatCell(node.data?.[fieldOf(i)], columns[i]?.type ?? 'string', zone)),
      );
      const headers = copyWithHeaders ? indexes.map((i) => columns[i]?.name ?? '') : undefined;
      void copyText(
        toTsv(headers, rows),
        `Copied ${String(rows.length)} row${rows.length === 1 ? '' : 's'}.`,
      );
      return;
    }
    const focused = api.getFocusedCell();
    if (focused === null) return;
    const node = api.getDisplayedRowAtIndex(focused.rowIndex);
    const index = Number(focused.column.getColId().slice(1));
    void copyText(formatCell(node?.data?.[fieldOf(index)], columns[index]?.type ?? 'string', zone));
  }, [columns, copyWithHeaders, zone]);

  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<GridRow>) => {
      const key = event.event as KeyboardEvent | null | undefined;
      if (key === null || key === undefined) return;
      if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === 'c') {
        key.preventDefault();
        copySelection();
      } else if (key.key === ' ' && event.data !== undefined) {
        key.preventDefault();
        showRow(event.data.__pos);
      }
    },
    [copySelection, showRow],
  );

  const onCellDoubleClicked = useCallback(
    (event: CellDoubleClickedEvent<GridRow>) => {
      if (event.data === undefined) return;
      const index = Number(event.column.getColId().slice(1));
      if (columns[index]?.type === 'dynamic') {
        updateTabResults(tabId, run.runId, {
          details: { kind: 'cell', position: event.data.__pos, column: index },
        });
      } else {
        showRow(event.data.__pos);
      }
    },
    [columns, showRow, tabId, run.runId],
  );

  const filterToValue = useCallback(
    (index: number, value: unknown, exclude: boolean) => {
      const column = columns[index];
      if (column === undefined) return;
      if (cellFilterMode === 'query' && appendWhere(column, value, exclude)) return;
      updateTabResults(tabId, run.runId, (state) => ({
        view: {
          ...state.view,
          valueFilters: [
            ...state.view.valueFilters,
            { column: index, mode: exclude ? 'exclude' : 'include', values: [value as null] },
          ],
        },
      }));
    },
    [cellFilterMode, columns, tabId, run.runId],
  );

  const onCellContextMenu = useCallback(
    (event: CellContextMenuEvent<GridRow>) => {
      const mouse = event.event as MouseEvent | null | undefined;
      if (event.data === undefined || mouse === null || mouse === undefined) return;
      const data = event.data;
      const index = Number(event.column.getColId().slice(1));
      const column = columns[index];
      const value = data[fieldOf(index)];
      const row = rowValues(data, columns);
      const workspace = workspaceByCustomerId(
        valueText(row[columns.findIndex((c) => c.name === '_WorkspaceId')]),
      );
      const links = linksEnabled ? rowLinks(columns, row) : [];
      const entries: MenuEntry[] = [
        {
          kind: 'item',
          label: 'Copy Value',
          run: () => void copyText(formatCell(value, column?.type ?? 'string', zone)),
        },
        {
          kind: 'item',
          label: 'Copy Row as JSON',
          run: () =>
            void copyText(
              JSON.stringify(
                Object.fromEntries(columns.map((c, i) => [c.name, row[i] ?? null])),
                null,
                2,
              ),
            ),
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Filter to This Value',
          run: () => {
            filterToValue(index, value, false);
          },
        },
        {
          kind: 'item',
          label: 'Exclude This Value',
          run: () => {
            filterToValue(index, value, true);
          },
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Show Row Details',
          keybinding: 'Space',
          run: () => {
            showRow(data.__pos);
          },
        },
        ...(column?.type === 'dynamic'
          ? [
              {
                kind: 'item' as const,
                label: 'Show Cell Details',
                run: () => {
                  updateTabResults(tabId, run.runId, {
                    details: { kind: 'cell', position: data.__pos, column: index },
                  });
                },
              },
            ]
          : []),
        ...(linksEnabled && workspace !== undefined
          ? [
              { kind: 'separator' as const },
              {
                kind: 'item' as const,
                label: 'Open Query in Azure Portal Logs',
                run: () => void openInPortal(workspace, run.query, run.timespan),
              },
              {
                kind: 'item' as const,
                label: 'Copy Azure Portal Link',
                run: () => void openInPortal(workspace, run.query, run.timespan, 'copy'),
              },
            ]
          : []),
        ...links.flatMap((link) => [
          { kind: 'item' as const, label: link.label, run: () => void openUrl(link.url) },
          {
            kind: 'item' as const,
            label: `Copy Link: ${link.label.replace(/^Open /, '')}`,
            run: () => void copyText(link.url, 'Link copied.'),
          },
        ]),
        ...extensionCellMenu({
          runId: run.runId,
          column: index,
          columnName: column?.name ?? '',
          value,
          columnValues: () => {
            const values: unknown[] = [];
            apiRef.current?.forEachNode((node) => {
              values.push(node.data?.[fieldOf(index)]);
            });
            return values;
          },
        }),
      ];
      setMenu({ x: mouse.clientX, y: mouse.clientY, entries });
    },
    [
      columns,
      filterToValue,
      linksEnabled,
      run.query,
      run.runId,
      run.timespan,
      showRow,
      tabId,
      zone,
    ],
  );

  return (
    <div className="results-grid">
      <AgGridReact<GridRow>
        theme={gridTheme}
        columnDefs={columnDefs}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={BLOCK_SIZE}
        maxBlocksInCache={50}
        getRowId={(params) => String(params.data.__pos)}
        rowSelection={{
          mode: 'multiRow',
          checkboxes: false,
          headerCheckbox: false,
          enableClickSelection: true,
        }}
        onGridReady={onGridReady}
        onSelectionChanged={onSelectionChanged}
        onSortChanged={onViewChanged}
        onFilterChanged={onViewChanged}
        onCellKeyDown={onCellKeyDown}
        onCellDoubleClicked={onCellDoubleClicked}
        onCellContextMenu={onCellContextMenu}
        preventDefaultOnContextMenu
        tooltipShowDelay={600}
        enableCellTextSelection={false}
        suppressDragLeaveHidesColumns
        multiSortKey="ctrl"
        defaultColDef={{ suppressHeaderMenuButton: false }}
        loadThemeGoogleFonts={false}
      />
      {menu === undefined ? null : (
        <ContextMenu
          label="Result cell"
          entries={menu.entries}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
    </div>
  );
}
