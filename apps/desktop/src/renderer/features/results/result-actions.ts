import { AppError } from '../../../shared/errors';
import type { ResultColumn, RunSnapshot } from '../../../shared/query/models';
import type { DisplayNames } from '../../../shared/results/display-names';
import {
  EXPORT_FORMAT_LABELS,
  INLINE_EXPORT_ROWS,
  type ExportFormat,
  type ExportRequest,
} from '../../../shared/results/export';
import { kqlLiteral, kqlName } from '../../../shared/results/kql-literal';
import { accessPathKey, type Workspace } from '../../../shared/workspaces/models';
import { notify } from '../../platform/notifications';
import {
  filterQuickPickItems,
  showQuickPick,
  type QuickPickItem,
} from '../../platform/quickinput/quick-input';
import { getSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { useAccounts } from '../accounts/accounts-store';
import { getActiveCodeEditor } from '../editor/active-editor';
import { buildNamer, currentNamer } from '../privacy/privacy';
import { useInventory } from '../workspaces/inventory-store';

import { buildDisplayNames } from './display-names';
import { tabResults, type TabResultsState } from './results-ui';

/** Actions on results shared by the grid, the panels and commands (spec 06). */

function reportError(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Results',
  });
}

export async function copyText(text: string, what = 'Copied to the clipboard.'): Promise<void> {
  try {
    await unwrap(getBridge().shell.writeClipboard({ text }));
    notify({ severity: 'info', message: what, source: 'Results' });
  } catch (error) {
    reportError(error, 'Could not copy to the clipboard.');
  }
}

/** Display names for what is on screen (`undefined` while real names are shown). */
export function currentDisplayNames(): DisplayNames | undefined {
  return buildDisplayNames(
    currentNamer(),
    useInventory.getState().inventory.workspaces,
    useAccounts.getState().snapshot.accounts,
  );
}

export function workspaceByCustomerId(customerId: string): Workspace | undefined {
  return useInventory
    .getState()
    .inventory.workspaces.find((w) => w.customerId.toLowerCase() === customerId.toLowerCase());
}

/**
 * "Open query in Azure Portal Logs" (spec 06). `#@tenant` is the tenant of the access path the
 * app uses (the managing tenant for Lighthouse), which is where the user's portal session is.
 */
export async function openInPortal(
  workspace: Workspace,
  query: string,
  timespan: string | undefined,
  mode: 'open' | 'copy' = 'open',
): Promise<void> {
  if (!getSetting('links.enabled')) return;
  const path =
    workspace.paths.find((p) => accessPathKey(p) === workspace.preferredPath) ?? workspace.paths[0];
  try {
    const { url } = await unwrap(
      getBridge().links.portalQuery({
        tenantId: path?.authorityTenantId ?? workspace.tenantId,
        workspaceResourceId: workspace.resourceId,
        query,
        ...(timespan !== undefined && timespan.startsWith('P') ? { timespan } : {}),
      }),
    );
    if (mode === 'copy') await copyText(url, 'Link copied.');
    else await unwrap(getBridge().shell.openExternal({ url }));
  } catch (error) {
    reportError(error, 'Could not open the Azure portal.');
  }
}

export async function openUrl(url: string): Promise<void> {
  try {
    await unwrap(getBridge().shell.openExternal({ url }));
  } catch (error) {
    reportError(error, 'That link cannot be opened.');
  }
}

/** "Filter to / Exclude this value" in query mode: append a `where` line (portal behaviour). */
export function appendWhere(column: ResultColumn, value: unknown, exclude: boolean): boolean {
  const editor = getActiveCodeEditor();
  const model = editor?.getModel();
  if (editor === undefined || model === null || model === undefined) return false;
  const literal = kqlLiteral(value, column.type);
  const condition =
    value === null || value === undefined || value === ''
      ? `${exclude ? 'isnotempty' : 'isempty'}(${kqlName(column.name)})`
      : `${kqlName(column.name)} ${exclude ? '!=' : '=='} ${literal}`;
  const lastLine = model.getLineCount();
  const lastColumn = model.getLineMaxColumn(lastLine);
  editor.executeEdits('results', [
    {
      range: {
        startLineNumber: lastLine,
        startColumn: lastColumn,
        endLineNumber: lastLine,
        endColumn: lastColumn,
      },
      text: `${model.getLineContent(lastLine).trim() === '' ? '' : '\n'}| where ${condition}`,
    },
  ]);
  editor.focus();
  return true;
}

// --- Export ------------------------------------------------------------------------------------

type InlineRows = Extract<ExportRequest['source'], { kind: 'rows' }>['rows'];

function pick<T extends string>(
  placeholder: string,
  items: (QuickPickItem & { id: T })[],
): Promise<T | undefined> {
  return new Promise((resolve) => {
    showQuickPick({
      placeholder,
      getItems: (filter) => filterQuickPickItems(items, filter),
      onAccept: (item) => {
        resolve(item?.id as T | undefined);
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

/** Aliases for an export, following `privacy.aliasing.applyToExports` (spec 03). */
async function exportNames(
  destination: 'file' | 'clipboard',
): Promise<DisplayNames | undefined | null> {
  const onScreen = currentDisplayNames();
  // Clipboard copies always match the screen.
  if (destination === 'clipboard') return onScreen;
  const aliases = (): DisplayNames | undefined =>
    buildDisplayNames(
      buildNamer(true),
      useInventory.getState().inventory.workspaces,
      useAccounts.getState().snapshot.accounts,
    );
  switch (getSetting('privacy.aliasing.applyToExports')) {
    case 'always':
      return aliases();
    case 'never':
      return undefined;
    case 'ask': {
      const aliased = onScreen !== undefined;
      const choice = await pick<'aliases' | 'real'>('Names in the export', [
        {
          id: aliased ? 'aliases' : 'real',
          label: aliased ? 'Aliases (as on screen)' : 'Real names (as on screen)',
        },
        {
          id: aliased ? 'real' : 'aliases',
          label: aliased ? 'Real names' : 'Aliases',
          description: aliased ? 'Reveals customer names in the file' : undefined,
        },
      ]);
      if (choice === undefined) return null;
      return choice === 'aliases' ? aliases() : undefined;
    }
  }
}

export interface ExportContext {
  run: RunSnapshot;
  tabId: string;
  /** Column indexes shown in the grid. */
  visibleColumns: number[];
  /** Export the grouped view instead of rows. */
  grouped: TabResultsState['grouped'];
}

export async function exportResults(
  context: ExportContext,
  destination: 'file' | 'clipboard',
  format?: ExportFormat,
): Promise<void> {
  const state = tabResults(context.tabId, context.run.runId);
  const formats = (Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[]).filter(
    (f) => destination === 'file' || f !== 'xlsx',
  );
  const chosen =
    format ??
    (await pick<ExportFormat>(
      destination === 'file' ? 'Export results as' : 'Copy results as',
      formats.map((f) => ({ id: f, label: EXPORT_FORMAT_LABELS[f] })),
    ));
  if (chosen === undefined) return;

  let source: ExportRequest['source'];
  if (context.grouped !== undefined) {
    source = {
      kind: 'rows',
      name: 'Grouped',
      columns: context.grouped.columns,
      // Grouped cells are copies of result cells, i.e. JSON values.
      rows: context.grouped.rows.slice(0, INLINE_EXPORT_ROWS) as InlineRows,
    };
  } else {
    const table =
      context.run.tables.find((t) => t.index === state.tableIndex) ?? context.run.tables[0];
    if (table === undefined) return;
    const filtered = state.filteredRows ?? table.rowCount;
    const scopes: (QuickPickItem & { id: 'all' | 'filtered' | 'selected' })[] = [
      { id: 'all', label: `All rows (${table.rowCount.toLocaleString()})` },
      ...(filtered !== table.rowCount
        ? [{ id: 'filtered' as const, label: `Filtered rows (${filtered.toLocaleString()})` }]
        : []),
      ...(state.selected.length > 0
        ? [
            {
              id: 'selected' as const,
              label: `Selected rows (${state.selected.length.toLocaleString()})`,
            },
          ]
        : []),
    ];
    const scope = scopes.length === 1 ? 'all' : await pick('Rows to include', scopes);
    if (scope === undefined) return;
    const hiddenColumns = table.columns.length - context.visibleColumns.length;
    const columns =
      hiddenColumns === 0
        ? 'visible'
        : await pick<'visible' | 'all'>('Columns to include', [
            { id: 'visible', label: `Visible columns (${String(context.visibleColumns.length)})` },
            { id: 'all', label: `All columns (${String(table.columns.length)})` },
          ]);
    if (columns === undefined) return;
    source = {
      kind: 'table',
      runId: context.run.runId,
      tableIndex: table.index,
      view: state.view,
      scope,
      ...(scope === 'selected' ? { positions: state.selected } : {}),
      ...(columns === 'visible' ? { columns: context.visibleColumns } : {}),
    };
  }

  const display = await exportNames(destination);
  if (display === null) return;
  try {
    const result = await unwrap(
      getBridge().results.export({
        source,
        format: chosen,
        destination,
        ...(display === undefined ? {} : { display }),
      }),
    );
    if (result.status === 'cancelled') return;
    notify({
      severity: 'info',
      message:
        result.status === 'copied'
          ? `Copied ${result.rows.toLocaleString()} row${result.rows === 1 ? '' : 's'} as ${EXPORT_FORMAT_LABELS[chosen]}.`
          : `Exported ${result.rows.toLocaleString()} row${result.rows === 1 ? '' : 's'} to ${result.path ?? 'a file'}.`,
      ...(result.notice === undefined ? {} : { detail: result.notice }),
      source: 'Results',
    });
  } catch (error) {
    reportError(error, 'The export failed.');
  }
}
