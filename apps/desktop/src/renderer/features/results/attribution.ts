import type { DisplayNamer } from '../../../shared/privacy/aliasing';
import type { ResultColumn } from '../../../shared/query/models';
import { valueText } from '../../../shared/results/values';
import type { Workspace } from '../../../shared/workspaces/models';

/**
 * Attribution cells (spec 04) hold real names in the main process; aliasing is applied here,
 * when rendering (spec 03), so presentation mode covers results too and toggling needs no
 * re-query.
 */
export interface AttributionContext {
  namer: DisplayNamer;
  workspaces: readonly Workspace[];
  /** Account usernames → account IDs (for account aliases). */
  accountIds: ReadonlyMap<string, string>;
}

export function makeCellFormatter(
  columns: readonly ResultColumn[],
  context: AttributionContext,
): (row: readonly unknown[], index: number) => string {
  const at = (name: string): number => columns.findIndex((c) => c.name === name);
  const tenantId = at('_TenantId');
  const workspaceId = at('_WorkspaceId');
  const byCustomerId = new Map(context.workspaces.map((w) => [w.customerId.toLowerCase(), w]));
  const workspaceOf = (row: readonly unknown[]): Workspace | undefined =>
    byCustomerId.get(formatValue(row[workspaceId]).toLowerCase());

  return (row, index) => {
    const column = columns[index];
    const value = row[index];
    if (column?.attribution === true) {
      switch (column.name) {
        case '_TenantName':
          return context.namer.tenant(formatValue(row[tenantId]), {
            displayName: formatValue(value),
          });
        case '_WorkspaceName': {
          const workspace = workspaceOf(row);
          return workspace === undefined
            ? context.namer.active
              ? 'Unlisted workspace'
              : formatValue(value)
            : context.namer.workspace(workspace);
        }
        case '_SubscriptionName': {
          const workspace = workspaceOf(row);
          return workspace === undefined
            ? context.namer.active
              ? 'Unlisted subscription'
              : formatValue(value)
            : context.namer.subscription(workspace);
        }
        case '_Account': {
          const username = formatValue(value);
          const id = context.accountIds.get(username);
          return id === undefined
            ? context.namer.active
              ? 'Account'
              : username
            : context.namer.account(id, username);
        }
        default:
          break;
      }
    }
    return formatValue(value);
  };
}

/** A plain cell value as text. */
export const formatValue = valueText;

/** Attribution columns hidden by `results.attributionColumns`; data columns always show. */
export function visibleColumnIndexes(
  columns: readonly ResultColumn[],
  shownAttribution: readonly string[],
): number[] {
  return columns.flatMap((column, index) =>
    column.attribution !== true || shownAttribution.includes(column.name) ? [index] : [],
  );
}
