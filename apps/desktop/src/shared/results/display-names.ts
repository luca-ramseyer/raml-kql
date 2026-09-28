import { z } from 'zod';

import type { ResultColumn } from '../query/models';

import { valueText } from './values';

/**
 * The names the workbench currently shows for attribution columns (spec 03 aliasing). Result
 * rows hold real names; while aliasing is on, the renderer sends this mapping so filtering,
 * search, sort and export in the main process work on what the user sees — searching for a
 * customer's real name must not find rows while names are aliased.
 */
export const DisplayNamesSchema = z.object({
  tenants: z.record(z.string().max(100), z.string().max(300)),
  /** By lowercase customer ID (`_WorkspaceId`). */
  workspaces: z.record(
    z.string().max(100),
    z.object({ workspace: z.string().max(400), subscription: z.string().max(400) }),
  ),
  /** By username (`_Account`). */
  accounts: z.record(z.string().max(300), z.string().max(300)),
});
export type DisplayNames = z.infer<typeof DisplayNamesSchema>;

/** A function that replaces attribution cells with display names (a no-op without names). */
export function displayNameMapper(
  columns: readonly ResultColumn[],
  names: DisplayNames | undefined,
): (row: unknown[]) => unknown[] {
  if (names === undefined) return (row) => row;
  const at = (name: string): number =>
    columns.findIndex((c) => c.attribution === true && c.name === name);
  const tenantName = at('_TenantName');
  const tenantId = at('_TenantId');
  const workspaceName = at('_WorkspaceName');
  const subscriptionName = at('_SubscriptionName');
  const workspaceId = at('_WorkspaceId');
  const account = at('_Account');
  return (row) => {
    const out = [...row];
    const workspace = names.workspaces[valueText(row[workspaceId]).toLowerCase()];
    if (tenantName >= 0)
      out[tenantName] = names.tenants[valueText(row[tenantId])] ?? 'Unlisted tenant';
    if (workspaceName >= 0) out[workspaceName] = workspace?.workspace ?? 'Unlisted workspace';
    if (subscriptionName >= 0) {
      out[subscriptionName] = workspace?.subscription ?? 'Unlisted subscription';
    }
    if (account >= 0) out[account] = names.accounts[valueText(row[account])] ?? 'Account';
    return out;
  };
}
