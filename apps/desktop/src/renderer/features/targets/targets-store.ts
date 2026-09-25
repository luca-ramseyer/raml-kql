import { create } from 'zustand';

import { resolveGroup } from '../../../shared/workspaces/groups';
import type { Workspace } from '../../../shared/workspaces/models';
import { useInventory, type InventoryState } from '../workspaces/inventory-store';

/**
 * Target selection (spec 03, "Targets view"). Until query tabs exist (Phase 4/7) there is one
 * selection for the session; it becomes per-tab state then.
 */
interface TargetsState {
  /** Selected workspace resource IDs. */
  selected: ReadonlySet<string>;
  /** Group shown in the Targets view; `undefined` = "All enabled". */
  groupId: string | undefined;
  /** The initial "select all enabled" has happened. */
  initialized: boolean;
}

export const useTargets = create<TargetsState>(() => ({
  selected: new Set(),
  groupId: undefined,
  initialized: false,
}));

/** Workspaces that can be targeted: enabled and not missing. */
export function targetableWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  return workspaces.filter((w) => w.enabled && !w.missing);
}

/** Workspaces visible in Targets for the current group filter. */
export function visibleTargets(
  groupId: string | undefined,
  { inventory, groups }: InventoryState = useInventory.getState(),
): Workspace[] {
  const usable = targetableWorkspaces(inventory.workspaces);
  const group = groups.groups.find((g) => g.id === groupId);
  if (group === undefined) return usable;
  const ids = new Set(resolveGroup(group, inventory.workspaces, inventory.tenants));
  return usable.filter((w) => ids.has(w.resourceId));
}

/**
 * Keep the selection consistent with the inventory: disabled or vanished workspaces drop out
 * of the selection, and the first inventory selects everything enabled.
 */
export function syncTargetsWithInventory(): void {
  const usable = new Set(
    targetableWorkspaces(useInventory.getState().inventory.workspaces).map((w) => w.resourceId),
  );
  const state = useTargets.getState();
  if (!state.initialized) {
    if (usable.size === 0) return;
    useTargets.setState({ selected: usable, initialized: true });
    return;
  }
  const selected = new Set([...state.selected].filter((id) => usable.has(id)));
  if (selected.size !== state.selected.size) useTargets.setState({ selected });
}

export function setSelected(ids: Iterable<string>, selected: boolean): void {
  const next = new Set(useTargets.getState().selected);
  for (const id of ids) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  useTargets.setState({ selected: next });
}

/** Choose a group: the view shows only its workspaces, and exactly those are selected. */
export function selectGroup(groupId: string | undefined): void {
  useTargets.setState({
    groupId,
    selected: new Set(visibleTargets(groupId).map((w) => w.resourceId)),
    initialized: true,
  });
}

export function selectedWorkspaces(): Workspace[] {
  const { selected } = useTargets.getState();
  return targetableWorkspaces(useInventory.getState().inventory.workspaces).filter((w) =>
    selected.has(w.resourceId),
  );
}
