import type { Account } from '../../../shared/auth/models';
import type { DisplayNamer } from '../../../shared/privacy/aliasing';
import type { DisplayNames } from '../../../shared/results/display-names';
import type { Workspace } from '../../../shared/workspaces/models';

/**
 * The attribution names on screen, for the main process to filter, search and export on
 * (spec 03: aliasing is a render-layer transform). `undefined` when real names are shown.
 */
export function buildDisplayNames(
  namer: DisplayNamer,
  workspaces: readonly Workspace[],
  accounts: readonly Pick<Account, 'id' | 'username' | 'label'>[],
): DisplayNames | undefined {
  if (!namer.active) return undefined;
  const tenants: Record<string, string> = {};
  const byCustomerId: DisplayNames['workspaces'] = {};
  for (const workspace of workspaces) {
    tenants[workspace.tenantId] ??= namer.tenant(workspace.tenantId);
    byCustomerId[workspace.customerId.toLowerCase()] = {
      workspace: namer.workspace(workspace),
      subscription: namer.subscription(workspace),
    };
  }
  return {
    tenants,
    workspaces: byCustomerId,
    accounts: Object.fromEntries(
      accounts.map((a) => [a.username, namer.account(a.id, a.label ?? a.username)]),
    ),
  };
}
