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

// --- Per-tab targets (spec 05: each tab has its own targets) -------------------------------

interface TabSelection {
  selected: ReadonlySet<string>;
  groupId: string | undefined;
}

const tabSelections = new Map<string, TabSelection>();
let currentTab: string | undefined;

function snapshot(): TabSelection {
  const { selected, groupId } = useTargets.getState();
  return { selected, groupId };
}

/** Give a new tab (split, duplicate) the same targets as another tab. */
export function copyTabTargets(fromTabId: string, toTabId: string): void {
  const source = fromTabId === currentTab ? snapshot() : tabSelections.get(fromTabId);
  if (source !== undefined)
    tabSelections.set(toTabId, { ...source, selected: new Set(source.selected) });
}

/** A tab's targets (for persistence). */
export function tabTargets(
  tabId: string,
): { selected: string[]; groupId: string | undefined } | undefined {
  const selection = tabId === currentTab ? snapshot() : tabSelections.get(tabId);
  return selection === undefined
    ? undefined
    : { selected: [...selection.selected], groupId: selection.groupId };
}

/** Restore a tab's targets (tabs.json). */
export function setTabTargets(
  tabId: string,
  selected: readonly string[],
  groupId: string | undefined,
): void {
  tabSelections.set(tabId, { selected: new Set(selected), groupId });
  if (tabId === currentTab)
    useTargets.setState({ selected: new Set(selected), groupId, initialized: true });
}

export function forgetTabTargets(tabId: string): void {
  tabSelections.delete(tabId);
  if (currentTab === tabId) currentTab = undefined;
}

/**
 * Follow the active query tab: its selection is shown in Targets and used for runs and the
 * schema. A tab without its own selection starts from the current one.
 */
export function startTabTargets(
  activeQueryTab: () => string | undefined,
  subscribe: (listener: () => void) => () => void,
): () => void {
  const onActiveChange = (): void => {
    const next = activeQueryTab();
    if (next === undefined || next === currentTab) return;
    if (currentTab !== undefined) tabSelections.set(currentTab, snapshot());
    currentTab = next;
    const saved = tabSelections.get(next);
    if (saved === undefined) {
      tabSelections.set(next, snapshot());
    } else {
      useTargets.setState({ selected: saved.selected, groupId: saved.groupId, initialized: true });
    }
  };
  const stopEditors = subscribe(onActiveChange);
  const stopTargets = useTargets.subscribe((state) => {
    if (currentTab !== undefined)
      tabSelections.set(currentTab, { selected: state.selected, groupId: state.groupId });
  });
  onActiveChange();
  return () => {
    stopEditors();
    stopTargets();
  };
}

/** For tests. */
export function resetTabTargets(): void {
  tabSelections.clear();
  currentTab = undefined;
}
