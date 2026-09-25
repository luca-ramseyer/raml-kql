import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { Inventory } from '../../../shared/workspaces/models';
import { setAliased } from '../privacy/privacy';

import { applyGroups, applyInventory } from './inventory-store';
import { WorkspacesEditor } from './WorkspacesEditor';

const T1 = '00000000-0000-0000-0000-00000000c001';
const ID = (n: string) =>
  `/subscriptions/s/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/${n}`;

const INVENTORY: Inventory = {
  refreshing: false,
  problems: [],
  tenants: [{ tenantId: T1, displayName: 'Contoso', tags: [], aliasNumber: 1 }],
  workspaces: ['la-a', 'la-b'].map((name) => ({
    resourceId: ID(name),
    name,
    customerId: name,
    location: 'westeurope',
    tenantId: T1,
    subscriptionId: 's',
    subscriptionName: 'SOC-Prod',
    resourceGroup: 'rg',
    sentinel: name === 'la-a',
    paths: [
      { accountId: 'acc-1', authorityTenantId: T1, via: 'home' as const },
      { accountId: 'acc-2', authorityTenantId: T1, via: 'guest' as const },
    ],
    missing: false,
    enabled: true,
    tags: [],
  })),
};

afterEach(() => {
  resetWorkbenchState();
});

function setup() {
  const harness = installWorkbenchHarness();
  act(() => {
    applyInventory(INVENTORY);
    applyGroups({ problems: [], groups: [] });
    setAliased(false);
  });
  render(<WorkspacesEditor />);
  return harness;
}

describe('WorkspacesEditor', () => {
  it('shows the tree and enables/disables workspaces', async () => {
    const harness = setup();
    expect(screen.getByText('2 of 2 workspaces enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable la-b' }));
    await waitFor(() => {
      expect(harness.deps.inventory.updateWorkspaces).toHaveBeenCalledWith({
        resourceIds: [ID('la-b')],
        enabled: false,
      });
    });
  });

  it('bulk-disables a tenant and filters to Sentinel', async () => {
    const harness = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Disable all in Contoso' }));
    await waitFor(() => {
      expect(harness.deps.inventory.updateWorkspaces).toHaveBeenCalledWith({
        resourceIds: [ID('la-a'), ID('la-b')],
        enabled: false,
      });
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Only Sentinel/ }));
    expect(screen.queryByRole('checkbox', { name: 'Enable la-b' })).not.toBeInTheDocument();
  });

  it('chooses the preferred access path when there are several', async () => {
    const harness = setup();
    const [select] = screen.getAllByRole('combobox', { name: 'Preferred access path' });
    fireEvent.change(select!, { target: { value: `acc-2|${T1}` } });
    await waitFor(() => {
      expect(harness.deps.inventory.updateWorkspaces).toHaveBeenCalledWith({
        resourceIds: [ID('la-a')],
        preferredPath: `acc-2|${T1}`,
      });
    });
  });

  it('creates a dynamic group', async () => {
    const harness = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Dynamic Group…' }));
    const form = screen.getByRole('form', { name: 'New dynamic group' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Swiss banks');
    await user.type(within(form).getByRole('textbox', { name: 'Tenant tags' }), 'bank, ch');
    await user.click(within(form).getByRole('button', { name: 'Save Group' }));
    await waitFor(() => {
      expect(harness.deps.groups.save).toHaveBeenCalledWith({
        id: 'swiss-banks',
        name: 'Swiss banks',
        type: 'dynamic',
        match: { tenantTags: ['bank', 'ch'], mode: 'all' },
      });
    });
  });

  it('aliases names here too while presentation mode is on', () => {
    setup();
    act(() => {
      setAliased(true);
    });
    expect(screen.queryByText('la-a')).not.toBeInTheDocument();
    expect(screen.getAllByText('Customer 01').length).toBeGreaterThan(0);
  });
});
