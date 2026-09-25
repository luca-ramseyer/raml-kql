import { registerCommand } from '../../platform/commands';
import { useEditors } from '../../platform/editors';
import { showPanelTab, togglePanel } from '../../platform/layout';
import { getSetting } from '../../platform/settings';
import { useRuns } from '../query/run-store';

import { isColumnShown } from './ColumnPicker';
import { applyGrouping, tenantGroupSpec } from './GroupBar';
import { currentDisplayNames, exportResults } from './result-actions';
import { EMPTY_VIEW, tabResults, updateTabResults } from './results-ui';

/** Palette commands for the active tab's results (spec 06). */
function activeResults() {
  const tabId = useEditors.getState().activeId;
  const run = tabId === undefined ? undefined : useRuns.getState().byTab[tabId];
  if (tabId === undefined || run === undefined) return undefined;
  const state = tabResults(tabId, run.runId);
  const table = run.tables.find((t) => t.index === state.tableIndex) ?? run.tables[0];
  return { tabId, run, state, table };
}

function exportContext() {
  const active = activeResults();
  if (active?.table === undefined) return undefined;
  const shown = getSetting('results.attributionColumns');
  return {
    run: active.run,
    tabId: active.tabId,
    visibleColumns: active.table.columns.flatMap((c, i) =>
      isColumnShown(c, active.state.columnOverrides, shown) ? [i] : [],
    ),
    grouped: active.state.showGrouped ? active.state.grouped : undefined,
  };
}

const HAS_RESULTS = "editorLangId == 'kusto'";

export function registerResultCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'results.export',
      title: 'Export Results…',
      category: 'Results',
      icon: 'desktop-download',
      when: HAS_RESULTS,
      run: () => {
        const context = exportContext();
        if (context !== undefined) void exportResults(context, 'file');
      },
    }),
    registerCommand({
      id: 'results.copyAs',
      title: 'Copy Results As…',
      category: 'Results',
      icon: 'copy',
      when: HAS_RESULTS,
      run: () => {
        const context = exportContext();
        if (context !== undefined) void exportResults(context, 'clipboard');
      },
    }),
    registerCommand({
      id: 'results.groupByTenant',
      title: 'Group by Tenant',
      category: 'Results',
      icon: 'group-by-ref-type',
      when: HAS_RESULTS,
      run: () => {
        const active = activeResults();
        if (active?.table === undefined) return;
        const spec = tenantGroupSpec(active.table.columns);
        if (spec === undefined) return;
        togglePanel(true);
        showPanelTab('results');
        void applyGrouping(
          active.tabId,
          active.run,
          active.table.index,
          spec,
          currentDisplayNames(),
        );
      },
    }),
    registerCommand({
      id: 'results.clearFilters',
      title: 'Clear Result Filters',
      category: 'Results',
      icon: 'clear-all',
      when: HAS_RESULTS,
      run: () => {
        const active = activeResults();
        if (active === undefined) return;
        updateTabResults(active.tabId, active.run.runId, { view: EMPTY_VIEW, showGrouped: false });
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
