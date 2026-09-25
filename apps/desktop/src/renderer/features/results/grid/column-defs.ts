import type { ColDef, SortModelItem } from 'ag-grid-community';

import type { ResultColumn } from '../../../../shared/query/models';
import type { ColumnFilter, ViewState } from '../../../../shared/results/view';
import type { KqlType } from '../../../../shared/schema/models';

import { dateTimeTooltip, formatCell, TYPE_ICONS, type DisplayZone } from './cell-format';

/**
 * Grid columns for a result table (spec 06). Fields are `c<index>` so column names never
 * collide with row metadata; `__pos` is the row's position in the stored table.
 */
export interface GridRow {
  __pos: number;
  [field: `c${number}`]: unknown;
}

export const fieldOf = (index: number): `c${number}` => `c${String(index)}` as `c${number}`;
export const indexOfField = (field: string): number => Number(field.slice(1));

function filterFor(type: KqlType): string {
  switch (type) {
    case 'int':
    case 'long':
    case 'real':
    case 'decimal':
      return 'agNumberColumnFilter';
    case 'datetime':
      return 'agDateColumnFilter';
    default:
      return 'agTextColumnFilter';
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/** AG Grid's default header layout plus a type icon (spec 06, "Column headers"). */
function headerTemplate(column: ResultColumn): string {
  const title =
    column.widenedFrom === undefined
      ? column.type
      : `${column.type} — workspaces returned ${column.widenedFrom.join(', ')}; widened to ${column.type}`;
  return `<div class="ag-cell-label-container" role="presentation">
  <span data-ref="eMenu" class="ag-header-icon ag-header-cell-menu-button"></span>
  <span data-ref="eFilterButton" class="ag-header-icon ag-header-cell-filter-button"></span>
  <div data-ref="eLabel" class="ag-header-cell-label" role="presentation">
    <span class="codicon codicon-${TYPE_ICONS[column.type]} column-type-icon" title="${escapeHtml(title)}"></span>
    <span data-ref="eText" class="ag-header-cell-text"></span>
    ${column.widenedFrom === undefined ? '' : `<span class="codicon codicon-info column-widened" title="${escapeHtml(title)}"></span>`}
    <span data-ref="eFilter" class="ag-header-icon ag-header-label-icon ag-filter-icon"></span>
    <ag-sort-indicator data-ref="eSortIndicator"></ag-sort-indicator>
  </div>
</div>`;
}

export function buildColumnDefs(
  columns: readonly ResultColumn[],
  options: { zone: DisplayZone; shownAttribution: readonly string[]; hidden: ReadonlySet<string> },
): ColDef<GridRow>[] {
  return columns.map((column, index) => {
    const numeric = ['int', 'long', 'real', 'decimal'].includes(column.type);
    const attribution = column.attribution === true;
    return {
      colId: fieldOf(index),
      field: fieldOf(index),
      headerName: column.name,
      headerTooltip: undefined,
      headerComponentParams: { template: headerTemplate(column) },
      headerClass: attribution ? 'attribution-header' : undefined,
      cellClass: [
        numeric ? 'cell-numeric' : undefined,
        column.type === 'dynamic' ? 'cell-dynamic' : undefined,
        attribution ? 'cell-attribution' : undefined,
      ].filter((c): c is string => c !== undefined),
      pinned: attribution ? 'left' : undefined,
      lockPinned: false,
      hide: attribution
        ? !options.shownAttribution.includes(column.name)
        : options.hidden.has(column.name),
      sortable: true,
      resizable: true,
      filter: filterFor(column.type),
      filterParams: { maxNumConditions: 2, buttons: ['reset'], debounceMs: 300 },
      valueFormatter: (params) => formatCell(params.value, column.type, options.zone),
      tooltipValueGetter: (params) =>
        column.type === 'datetime'
          ? dateTimeTooltip(params.value)
          : (() => {
              const text = formatCell(params.value, column.type, options.zone);
              return text.length > 80 ? text.slice(0, 2000) : undefined;
            })(),
      minWidth: 60,
      width: attribution ? 150 : column.type === 'datetime' ? 190 : numeric ? 100 : 160,
    } satisfies ColDef<GridRow>;
  });
}

/** AG Grid's sort and filter models → the view evaluated in the main process. */
export function viewFromGrid(
  sortModel: readonly SortModelItem[],
  filterModel: Record<string, unknown>,
  base: Pick<ViewState, 'quickSearch' | 'valueFilters'>,
): ViewState {
  return {
    sort: sortModel.map((s) => ({ column: indexOfField(s.colId), direction: s.sort })),
    filters: Object.fromEntries(
      Object.entries(filterModel).map(([colId, model]) => [
        String(indexOfField(colId)),
        model as ColumnFilter,
      ]),
    ),
    quickSearch: base.quickSearch,
    valueFilters: base.valueFilters,
  };
}
