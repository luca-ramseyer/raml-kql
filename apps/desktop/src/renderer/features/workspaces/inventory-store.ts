import { create } from 'zustand';

import { AppError } from '../../../shared/errors';
import type { Group, GroupsSnapshot } from '../../../shared/workspaces/groups';
import type { Inventory, TenantUpdate, WorkspaceUpdate } from '../../../shared/workspaces/models';
import { executeCommand } from '../../platform/commands';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';

export interface InventoryState {
  inventory: Inventory;
  groups: GroupsSnapshot;
}

export const EMPTY_INVENTORY: Inventory = {
  workspaces: [],
  tenants: [],
  refreshing: false,
  problems: [],
};

export const useInventory = create<InventoryState>(() => ({
  inventory: EMPTY_INVENTORY,
  groups: { groups: [], problems: [] },
}));

export function applyInventory(inventory: Inventory): void {
  useInventory.setState({ inventory });
}

let lastGroupProblems = '';
export function applyGroups(groups: GroupsSnapshot): void {
  useInventory.setState({ groups });
  const signature = JSON.stringify(groups.problems);
  if (signature !== lastGroupProblems && groups.problems.length > 0) {
    notify({
      key: 'groups-problems',
      severity: 'warning',
      message: `groups.jsonc: ${groups.problems[0]?.message ?? 'has problems'}`,
      detail: groups.problems.map((p) => p.message).join('\n'),
    });
  }
  lastGroupProblems = signature;
}

/** "5 new workspaces discovered — Review" (spec 03, "Discovery lifecycle"). */
export function notifyNewWorkspaces(count: number): void {
  notify({
    key: 'new-workspaces',
    message: `${String(count)} new workspace${count === 1 ? '' : 's'} discovered.`,
    actions: [
      {
        label: 'Review',
        run: () => void executeCommand('workbench.action.openWorkspacesSettings'),
      },
    ],
  });
}

function reportError(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Workspaces',
  });
}

export async function loadInventory(): Promise<void> {
  try {
    const [inventory, groups] = await Promise.all([
      unwrap(getBridge().inventory.get()),
      unwrap(getBridge().groups.get()),
    ]);
    applyInventory(inventory);
    applyGroups(groups);
  } catch (error) {
    reportError(error, 'Could not load workspaces.');
  }
}

export async function refreshInventory(): Promise<void> {
  try {
    applyInventory(await unwrap(getBridge().inventory.refresh()));
  } catch (error) {
    reportError(error, 'Discovery failed.');
  }
}

export async function updateWorkspaces(update: WorkspaceUpdate): Promise<void> {
  try {
    applyInventory(await unwrap(getBridge().inventory.updateWorkspaces(update)));
  } catch (error) {
    reportError(error, 'Could not save the workspace change.');
  }
}

export async function updateTenant(update: TenantUpdate): Promise<void> {
  try {
    applyInventory(await unwrap(getBridge().inventory.updateTenant(update)));
  } catch (error) {
    reportError(error, 'Could not save the tenant change.');
  }
}

export async function saveGroup(group: Group): Promise<boolean> {
  try {
    applyGroups(await unwrap(getBridge().groups.save(group)));
    return true;
  } catch (error) {
    reportError(error, 'Could not save the group.');
    return false;
  }
}

export async function deleteGroup(id: string): Promise<void> {
  try {
    applyGroups(await unwrap(getBridge().groups.delete({ id })));
  } catch (error) {
    reportError(error, 'Could not delete the group.');
  }
}
