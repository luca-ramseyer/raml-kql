import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { TabsState } from '../../../shared/query/tabs';
import type { Inventory, Workspace } from '../../../shared/workspaces/models';
import { App } from '../../App';
import { resetOpenQuery } from '../query/open-query';

import { resetTabTargets, useTargets } from './targets-store';

vi.mock('../editor/editor-preload', () => ({
  loadQueryEditor: () => new Promise(() => undefined),
  loadedQueryEditor: () => undefined,
  preloadQueryEditorWhenIdle: () => () => undefined,
}));

const T1 = '00000000-0000-0000-0000-00000000c001';
const ws = (name: string): Workspace => ({
  resourceId: `/subscriptions/s/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/${name}`,
  name,
  customerId: name,
  location: 'westeurope',
  tenantId: T1,
  subscriptionId: 's',
  subscriptionName: 'SOC',
  resourceGroup: 'rg',
  sentinel: false,
  paths: [{ accountId: 'acc', authorityTenantId: T1, via: 'home' }],
  missing: false,
  enabled: true,
  tags: [],
});
const WORKSPACES = [ws('a'), ws('b'), ws('c')];
const INVENTORY: Inventory = {
  refreshing: false,
  problems: [],
  tenants: [{ tenantId: T1, displayName: 'Contoso', tags: [], aliasNumber: 1 }],
  workspaces: WORKSPACES,
};

const TABS: TabsState = {
  version: 1,
  queryCounter: 1,
  activeGroupId: 'group-1',
  groups: [
    {
      id: 'group-1',
      size: 1,
      activeId: 'query-1',
      editors: [
        {
          id: 'query-1',
          kind: 'query',
          title: 'Query 1',
          query: {
            text: 'Heartbeat',
            timeRange: { kind: 'preset', preset: '24h' },
            targets: [WORKSPACES[0]?.resourceId ?? '', WORKSPACES[1]?.resourceId ?? ''],
          },
        },
      ],
    },
  ],
};

describe('restored tabs', () => {
  afterEach(() => {
    resetWorkbenchState();
    resetTabTargets();
    resetOpenQuery();
    useTargets.setState({ selected: new Set(), groupId: undefined, initialized: false });
  });

  it('bring back their target selection', async () => {
    installWorkbenchHarness({
      inventory: {
        snapshot: () => INVENTORY,
        refresh: vi.fn(() => Promise.resolve(INVENTORY)),
        updateWorkspaces: vi.fn(() => Promise.resolve(INVENTORY)),
        updateTenant: vi.fn(() => Promise.resolve(INVENTORY)),
      },
      tabs: { read: vi.fn(() => Promise.resolve(TABS)), write: vi.fn(() => Promise.resolve()) },
    });
    render(<App />);
    await screen.findByTestId('workbench');
    await waitFor(() => {
      expect([...useTargets.getState().selected].sort()).toEqual(
        [WORKSPACES[0]?.resourceId, WORKSPACES[1]?.resourceId].sort(),
      );
    });
    expect(await screen.findByText('2 of 3 selected')).toBeInTheDocument();
  });

  it('keep their selection when the inventory arrives after them', async () => {
    let current: Inventory = { ...INVENTORY, workspaces: [], refreshing: true };
    const harness = installWorkbenchHarness({
      inventory: {
        snapshot: () => current,
        refresh: vi.fn(() => Promise.resolve(current)),
        updateWorkspaces: vi.fn(() => Promise.resolve(current)),
        updateTenant: vi.fn(() => Promise.resolve(current)),
      },
      tabs: { read: vi.fn(() => Promise.resolve(TABS)), write: vi.fn(() => Promise.resolve()) },
    });
    render(<App />);
    await screen.findByTestId('workbench');
    await waitFor(() => {
      expect(useTargets.getState().selected.size).toBe(2);
    });
    // The inventory is still empty for a moment after the tabs are restored.
    act(() => {
      harness.emit('inventory.changed', current);
    });
    current = INVENTORY;
    act(() => {
      harness.emit('inventory.changed', INVENTORY);
    });
    expect(await screen.findByText('2 of 3 selected')).toBeInTheDocument();
  });
});
