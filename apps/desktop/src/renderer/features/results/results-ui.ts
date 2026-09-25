import { create } from 'zustand';

import type { ResultColumn } from '../../../shared/query/models';
import type { GroupSpec } from '../../../shared/results/aggregate';
import type { ViewState } from '../../../shared/results/view';

/**
 * Per query tab UI state of the results panel (spec 06): which result table is shown, the
 * grid's view (sort, filters, search), selection, the grouped view and chart settings. Only
 * view settings and shapes live here; rows stay in the main process.
 */
export interface GroupedView {
  spec: GroupSpec;
  columns: ResultColumn[];
  rows: unknown[][];
  truncated: boolean;
}

export type ChartKind =
  'line' | 'area' | 'stackedArea' | 'column' | 'bar' | 'pie' | 'scatter' | 'card';

export interface ChartSettings {
  /** `undefined`: follow the query's `render` spec. */
  kind?: ChartKind | undefined;
  x?: string | undefined;
  y?: string[] | undefined;
  series?: string | undefined;
  aggregation?: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max' | undefined;
  /** "Split by tenant" (spec 06); `undefined`: automatic. */
  splitByTenant?: boolean | undefined;
  /** Chart the grouped view instead of the rows. */
  fromGrouped?: boolean | undefined;
}

export interface TabResultsState {
  runId: string | undefined;
  tableIndex: number;
  view: ViewState;
  /** Rows matching the view, from the last page loaded. */
  filteredRows: number | undefined;
  /** Positions of selected rows. */
  selected: number[];
  grouped: GroupedView | undefined;
  showGrouped: boolean;
  chart: ChartSettings;
  /** Column name → shown, overriding the defaults for this tab (column picker). */
  columnOverrides: Record<string, boolean>;
  details:
    | { kind: 'row'; position: number }
    | { kind: 'cell'; position: number; column: number }
    | undefined;
}

// A stable initial object per (tab, run), so hook selectors don't return a new object on
// every call (which would re-render forever).
const initials = new Map<string, TabResultsState>();

export const EMPTY_VIEW: ViewState = { sort: [], filters: {}, quickSearch: '', valueFilters: [] };

function initial(runId: string | undefined): TabResultsState {
  return {
    runId,
    tableIndex: 0,
    view: EMPTY_VIEW,
    filteredRows: undefined,
    selected: [],
    grouped: undefined,
    showGrouped: false,
    chart: {},
    columnOverrides: {},
    details: undefined,
  };
}

export const useResultsUi = create<{ byTab: Record<string, TabResultsState> }>(() => ({
  byTab: {},
}));

/** The tab's state; reset when a new run replaces the results. */
export function tabResults(tabId: string, runId: string | undefined): TabResultsState {
  const state = useResultsUi.getState().byTab[tabId];
  return state !== undefined && state.runId === runId ? state : initial(runId);
}

export function updateTabResults(
  tabId: string,
  runId: string | undefined,
  patch: Partial<TabResultsState> | ((state: TabResultsState) => Partial<TabResultsState>),
): void {
  useResultsUi.setState((s) => {
    const current = tabResults(tabId, runId);
    const next = typeof patch === 'function' ? patch(current) : patch;
    return { byTab: { ...s.byTab, [tabId]: { ...current, ...next } } };
  });
}

export function forgetTabResults(tabId: string): void {
  for (const key of initials.keys()) if (key.startsWith(`${tabId}|`)) initials.delete(key);
  useResultsUi.setState((s) => {
    const { [tabId]: _removed, ...byTab } = s.byTab;
    return { byTab };
  });
}

/** React hook for one tab's results state. */
export function useTabResults(
  tabId: string | undefined,
  runId: string | undefined,
): TabResultsState {
  return useResultsUi((s) => {
    if (tabId === undefined) return initialFor('', runId);
    const state = s.byTab[tabId];
    return state !== undefined && state.runId === runId ? state : initialFor(tabId, runId);
  });
}

function initialFor(tabId: string, runId: string | undefined): TabResultsState {
  const key = `${tabId}|${runId ?? ''}`;
  let state = initials.get(key);
  if (state === undefined) {
    state = initial(runId);
    // One entry per tab: a new run replaces the tab's previous entry.
    for (const old of initials.keys()) if (old.startsWith(`${tabId}|`)) initials.delete(old);
    initials.set(key, state);
  }
  return state;
}
