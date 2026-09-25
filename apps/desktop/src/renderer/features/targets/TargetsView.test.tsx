import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findQuickInputBox,
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { Inventory, Workspace } from '../../../shared/workspaces/models';
import { App } from '../../App';
import { setAliased } from '../privacy/privacy';

import { useTargets } from './targets-store';

const T1 = '00000000-0000-0000-0000-00000000c001';
const T2 = '00000000-0000-0000-0000-00000000c004';

const ws = (name: string, tenantId: string, extra: Partial<Workspace> = {}): Workspace => ({
  resourceId: `/subscriptions/s/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/${name}`,
  name,
  customerId: name,
  location: 'westeurope',
  tenantId,
  subscriptionId: 's',
  subscriptionName: 'SOC-Prod',
  resourceGroup: 'rg',
  sentinel: name.includes('sentinel'),
  paths: [{ accountId: 'acc', authorityTenantId: T1, via: 'home' }],
  missing: false,
  enabled: true,
  tags: [],
  ...extra,
});

const INVENTORY: Inventory = {
  refreshing: false,
  problems: [],
  tenants: [
    { tenantId: T1, displayName: 'Contoso', tags: [], aliasNumber: 1 },
    { tenantId: T2, displayName: 'Fabrikam', tags: [], aliasNumber: 2 },
  ],
  workspaces: [
    ws('la-contoso-sentinel', T1),
    ws('la-contoso-apps', T1),
    ws('la-fabrikam-sentinel', T2),
  ],
};

/** Workspace rows (tree level 2); Testing Library can't query treeitem levels directly. */
const workspaceItems = (): HTMLElement[] =>
  screen.queryAllByRole('treeitem').filter((item) => item.getAttribute('aria-level') === '2');

afterEach(() => {
  resetWorkbenchState();
  useTargets.setState({ selected: new Set(), groupId: undefined, initialized: false });
});

async function renderApp(
  inventory: Inventory = INVENTORY,
  settings: Record<string, unknown> = {},
  options: { strict?: boolean } = {},
) {
  let current = inventory;
  const harness = installWorkbenchHarness(
    {
      inventory: {
        snapshot: () => current,
        refresh: vi.fn(() => Promise.resolve(current)),
        updateWorkspaces: vi.fn(() => Promise.resolve(current)),
        updateTenant: vi.fn(() => Promise.resolve(current)),
      },
      groups: {
        snapshot: () => ({
          problems: [],
          groups: [
            {
              id: 'all-sentinel',
              name: 'All Sentinel',
              type: 'dynamic',
              match: { sentinel: true },
            },
          ],
        }),
        save: vi.fn((group) => Promise.resolve({ problems: [], groups: [group] })),
        delete: vi.fn(() => Promise.resolve({ problems: [], groups: [] })),
      },
    },
    settings as never,
  );
  render(
    options.strict === true ? (
      <StrictMode>
        <App />
      </StrictMode>
    ) : (
      <App />
    ),
  );
  await (inventory.workspaces.length === 0
    ? screen.findByTestId('workbench')
    : screen.findByRole('tree', { name: 'Targets' }));
  return {
    harness,
    setInventory(next: Inventory) {
      current = next;
      act(() => {
        harness.emit('inventory.changed', next);
      });
    },
  };
}

describe('Targets view', () => {
  it('starts aliased and selects every enabled workspace', async () => {
    await renderApp();
    const tree = screen.getByRole('tree', { name: 'Targets' });
    expect(within(tree).queryByText('Contoso')).not.toBeInTheDocument();
    expect(within(tree).getByText('Customer 01')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 workspaces · 2 tenants/ })).toBeInTheDocument();
  });

  it('selects workspaces that arrive after start-up, also when the workbench mounts twice', async () => {
    // React StrictMode (dev) starts the workbench twice and stops the first start. Its
    // teardown must not remove the second start's inventory subscription.
    const { setInventory } = await renderApp(
      { ...INVENTORY, workspaces: [] },
      {},
      { strict: true },
    );
    setInventory(INVENTORY);
    await waitFor(() => {
      expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /3 workspaces · 2 tenants/ })).toBeInTheDocument();
  });

  it('updates every visible name instantly when aliasing is toggled', async () => {
    await renderApp();
    act(() => {
      setAliased(false);
    });
    const tree = screen.getByRole('tree', { name: 'Targets' });
    expect(within(tree).getByText('Contoso')).toBeInTheDocument();
    expect(within(tree).getByText('la-contoso-apps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Real names/ })).toBeInTheDocument();
  });

  it('asks before revealing real names', async () => {
    const user = userEvent.setup();
    await renderApp();
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true, altKey: true });
    await findQuickInputBox();
    expect(screen.getByRole('option', { name: /Stay Aliased/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Show Real Names/ }));
    expect(
      within(screen.getByRole('tree', { name: 'Targets' })).getByText('Fabrikam'),
    ).toBeInTheDocument();
  });

  it('hides disabled workspaces and drops them from the selection', async () => {
    const { setInventory } = await renderApp();
    setInventory({
      ...INVENTORY,
      workspaces: INVENTORY.workspaces.map((w) =>
        w.name === 'la-contoso-apps' ? { ...w, enabled: false } : w,
      ),
    });
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
    expect(workspaceItems()).toHaveLength(2);
  });

  it('groups select exactly their workspaces', async () => {
    await renderApp(INVENTORY, { 'privacy.aliasing.activeOnStartup': false });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
      target: { value: 'all-sentinel' },
    });
    const items = workspaceItems().map((i) => i.textContent);
    expect(items).toEqual([
      expect.stringContaining('la-contoso-sentinel'),
      expect.stringContaining('la-fabrikam-sentinel'),
    ]);
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
  });

  it('tenant checkbox selects and clears all its workspaces', async () => {
    await renderApp(INVENTORY, { 'privacy.aliasing.activeOnStartup': false });
    const tenantBox = screen.getByRole('checkbox', { name: 'Select all workspaces in Contoso' });
    fireEvent.click(tenantBox);
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
    fireEvent.click(tenantBox);
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
  });

  it('saves the selection as a static group', async () => {
    const user = userEvent.setup();
    const { harness } = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Save Selection as Group…' }));
    const input = await findQuickInputBox();
    await user.type(input, 'On call{Enter}');
    await waitFor(() => {
      expect(harness.deps.groups.save).toHaveBeenCalledWith({
        id: 'on-call',
        name: 'On call',
        type: 'static',
        workspaces: INVENTORY.workspaces.map((w) => w.resourceId),
      });
    });
  });

  it('searches the displayed names only (no real-name leaks while aliased)', async () => {
    await renderApp();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search workspaces' }), {
      target: { value: 'fabrikam' },
    });
    expect(workspaceItems()).toHaveLength(0);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search workspaces' }), {
      target: { value: 'customer 02' },
    });
    expect(workspaceItems()).toHaveLength(1);
  });
});
