import { z } from 'zod';

import type { InventoryTenant, Workspace } from './models';

/** Tenant/workspace groups in groups.jsonc (spec 03, "Tenant groups"). */
export const GroupMatchSchema = z
  .object({
    sentinel: z.boolean().optional(),
    tenantIds: z.array(z.string()).max(1000).optional(),
    tenantTags: z.array(z.string()).max(100).optional(),
    workspaceTags: z.array(z.string()).max(100).optional(),
    nameRegex: z.string().max(500).optional(),
    location: z.string().max(100).optional(),
    accountIds: z.array(z.string()).max(100).optional(),
    mode: z.enum(['all', 'any']).optional(),
  })
  .strict();
export type GroupMatch = z.infer<typeof GroupMatchSchema>;

const base = {
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Use letters, digits, ".", "_" or "-"'),
  name: z.string().min(1).max(200),
};

export const GroupSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('dynamic'), match: GroupMatchSchema }).strict(),
  z
    .object({
      ...base,
      type: z.literal('static'),
      workspaces: z.array(z.string().max(1000)).max(5000),
    })
    .strict(),
]);
export type Group = z.infer<typeof GroupSchema>;

export const GroupsSnapshotSchema = z.object({
  groups: z.array(GroupSchema),
  problems: z.array(z.object({ file: z.string(), line: z.number().int(), message: z.string() })),
});
export type GroupsSnapshot = z.infer<typeof GroupsSnapshotSchema>;

function safeRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return undefined;
  }
}

/**
 * Does a workspace match a dynamic group? Every condition that is set must hold (`mode: all`,
 * the default) or at least one must hold (`mode: any`). Tag lists match when the workspace (or
 * its tenant) has all of them in `all` mode, or any of them in `any` mode.
 */
export function matchesGroup(
  match: GroupMatch,
  workspace: Workspace,
  tenant: InventoryTenant | undefined,
): boolean {
  const any = match.mode === 'any';
  const tagsMatch = (wanted: string[], have: string[]): boolean => {
    const set = new Set(have.map((t) => t.toLowerCase()));
    return any
      ? wanted.some((t) => set.has(t.toLowerCase()))
      : wanted.every((t) => set.has(t.toLowerCase()));
  };
  const conditions: boolean[] = [];
  if (match.sentinel !== undefined) conditions.push(workspace.sentinel === match.sentinel);
  if (match.tenantIds !== undefined) {
    conditions.push(match.tenantIds.some((id) => id.toLowerCase() === workspace.tenantId));
  }
  if (match.tenantTags !== undefined)
    conditions.push(tagsMatch(match.tenantTags, tenant?.tags ?? []));
  if (match.workspaceTags !== undefined) {
    conditions.push(tagsMatch(match.workspaceTags, workspace.tags));
  }
  if (match.nameRegex !== undefined) {
    conditions.push(safeRegex(match.nameRegex)?.test(workspace.name) ?? false);
  }
  if (match.location !== undefined) {
    conditions.push(workspace.location.toLowerCase() === match.location.toLowerCase());
  }
  if (match.accountIds !== undefined) {
    conditions.push(workspace.paths.some((p) => match.accountIds?.includes(p.accountId) === true));
  }
  if (conditions.length === 0) return true;
  return any ? conditions.some(Boolean) : conditions.every(Boolean);
}

/** Resource IDs a group selects. Groups only ever resolve to enabled, present workspaces. */
export function resolveGroup(
  group: Group,
  workspaces: readonly Workspace[],
  tenants: readonly InventoryTenant[],
): string[] {
  const usable = workspaces.filter((w) => w.enabled && !w.missing);
  if (group.type === 'static') {
    const wanted = new Set(group.workspaces.map((id) => id.toLowerCase()));
    return usable.filter((w) => wanted.has(w.resourceId)).map((w) => w.resourceId);
  }
  const byTenant = new Map(tenants.map((t) => [t.tenantId, t]));
  return usable
    .filter((w) => matchesGroup(group.match, w, byTenant.get(w.tenantId)))
    .map((w) => w.resourceId);
}
