import { describe, expect, it, vi } from 'vitest';

import type { AccountsSnapshot } from '../../shared/auth/models';
import { DEMO_TENANTS } from '../auth/demo-provider';
import type { DiscoveryQueryKind } from '../azure/resource-graph';
import { MemoryWorkspacesConfig } from '../config/workspaces-config';
import { demoDiscoveryRows, DEMO_TENANT_NAMES } from '../demo/demo-inventory';

import { DiscoveryService, type DiscoverySource } from './discovery-service';
import { MemoryInventoryCache } from './inventory-cache';

const HOME = '00000000-0000-0000-0000-0000000000a1';
const GUEST = '00000000-0000-0000-0000-0000000000b2';
const CUSTOMER = '00000000-0000-0000-0000-0000000000c3';

const ws = (name: string, tenantId: string, sub = '00000000-0000-0000-0000-000000000501') => ({
  id: `/subscriptions/${sub}/resourceGroups/RG/providers/Microsoft.OperationalInsights/workspaces/${name}`,
  name,
  location: 'westeurope',
  tenantId,
  subscriptionId: sub,
  resourceGroup: 'RG',
  customerId: `cust-${name}`,
  retentionInDays: 90,
  sku: 'PerGB2018',
});

function accounts(overrides: Partial<AccountsSnapshot['accounts'][number]> = {}): AccountsSnapshot {
  return {
    builtinAvailable: true,
    persistence: 'encrypted',
    accounts: [
      {
        id: 'acc-1',
        username: 'analyst@contoso.example',
        provider: 'builtin',
        homeTenantId: HOME,
        refreshing: false,
        tenants: [
          { tenantId: HOME, relation: 'home', state: 'ok', displayName: 'Contoso' },
          { tenantId: GUEST, relation: 'guest', state: 'ok', displayName: 'Northwind' },
          {
            tenantId: CUSTOMER,
            relation: 'lighthouse',
            state: 'noAccess',
            displayName: 'Fabrikam',
          },
        ],
        ...overrides,
      },
    ],
  };
}

function setup(
  rowsByTenant: Record<string, Record<string, unknown>[]>,
  /** Read on every query, so tests can change it between refreshes. */
  options: { snapshot?: AccountsSnapshot; failTenant?: string } = {},
) {
  let snapshot = options.snapshot ?? accounts();
  const source: DiscoverySource = {
    query: vi.fn((kind: DiscoveryQueryKind, { tenantId }: { tenantId: string }) => {
      if (tenantId === options.failTenant) return Promise.reject(new Error('HTTP 500'));
      if (kind === 'workspaces') return Promise.resolve(rowsByTenant[tenantId] ?? []);
      if (kind === 'subscriptions') {
        return Promise.resolve([
          {
            subscriptionId: '00000000-0000-0000-0000-000000000501',
            subscriptionName: 'SOC-Prod',
            tenantId,
          },
        ]);
      }
      const first = rowsByTenant[tenantId]?.[0]?.['id'];
      return Promise.resolve([
        { workspaceResourceId: typeof first === 'string' ? first.toLowerCase() : '' },
      ]);
    }),
  };
  const config = new MemoryWorkspacesConfig();
  const cache = new MemoryInventoryCache();
  const onNewWorkspaces = vi.fn();
  const service = new DiscoveryService({
    auth: {
      snapshot: () => snapshot,
      getToken: vi.fn(() => Promise.resolve({ token: 't', expiresOn: new Date(10 ** 13) })),
    },
    source,
    config,
    cache,
    newWorkspaceDefault: () => 'enabled',
    onChange: vi.fn(),
    onNewWorkspaces,
    now: () => new Date('2026-09-25T10:00:00Z'),
  });
  return {
    service,
    source,
    config,
    cache,
    onNewWorkspaces,
    setSnapshot: (s: AccountsSnapshot) => (snapshot = s),
  };
}

describe('DiscoveryService', () => {
  it('discovers per signed-in tenant, maps access paths and keeps metadata only', async () => {
    const { service } = setup({
      [HOME]: [ws('la-contoso', HOME), ws('la-fabrikam', CUSTOMER)],
      [GUEST]: [ws('la-northwind', GUEST)],
    });
    const inventory = await service.refresh();
    const byName = Object.fromEntries(inventory.workspaces.map((w) => [w.name, w]));
    expect(byName['la-contoso']?.paths).toEqual([
      { accountId: 'acc-1', authorityTenantId: HOME, via: 'home' },
    ]);
    expect(byName['la-fabrikam']?.paths).toEqual([
      { accountId: 'acc-1', authorityTenantId: HOME, via: 'lighthouse' },
    ]);
    expect(byName['la-northwind']?.paths).toEqual([
      { accountId: 'acc-1', authorityTenantId: GUEST, via: 'guest' },
    ]);
    expect(byName['la-contoso']).toMatchObject({
      resourceId: expect.stringMatching(/^\/subscriptions\/.*\/workspaces\/la-contoso$/) as unknown,
      sentinel: true,
      subscriptionName: 'SOC-Prod',
      enabled: true,
      missing: false,
    });
    expect(byName['la-contoso']?.resourceId).toBe(byName['la-contoso']?.resourceId.toLowerCase());
    expect(inventory.refreshedAt).toBe('2026-09-25T10:00:00.000Z');
  });

  it('dedupes a workspace reachable through two accounts, keeping both paths', async () => {
    const snapshot = accounts();
    snapshot.accounts.push({
      id: 'acc-2',
      username: 'guest@woodgrove.example',
      provider: 'builtin',
      homeTenantId: GUEST,
      refreshing: false,
      tenants: [{ tenantId: GUEST, relation: 'home', state: 'ok' }],
    });
    const { service } = setup(
      { [HOME]: [ws('la-shared', GUEST)], [GUEST]: [ws('la-shared', GUEST)] },
      { snapshot },
    );
    const inventory = await service.refresh();
    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]?.paths.map((p) => `${p.accountId}:${p.via}`)).toEqual([
      'acc-1:lighthouse',
      'acc-1:guest',
      'acc-2:home',
    ]);
  });

  it('never queries tenants that need sign-in or have no access', async () => {
    const { service, source } = setup(
      {},
      {
        snapshot: accounts({
          tenants: [
            { tenantId: HOME, relation: 'home', state: 'needsReauth' },
            { tenantId: GUEST, relation: 'guest', state: 'noAccess' },
          ],
        }),
      },
    );
    await service.refresh();
    expect(source.query).not.toHaveBeenCalled();
  });

  it('marks vanished workspaces missing only after a complete discovery', async () => {
    const rows = { [HOME]: [ws('la-a', HOME), ws('la-b', HOME)] };
    const { service } = setup(rows, {});
    await service.refresh();
    rows[HOME] = [ws('la-a', HOME)];
    const inventory = await service.refresh();
    expect(inventory.workspaces.find((w) => w.name === 'la-b')?.missing).toBe(true);
  });

  it('keeps workspaces of a failing tenant (a partial discovery never marks them missing)', async () => {
    const options: { failTenant?: string } = {};
    const { service } = setup(
      { [HOME]: [ws('la-a', HOME)], [GUEST]: [ws('la-g', GUEST)] },
      options,
    );
    await service.refresh();
    options.failTenant = GUEST; // the guest tenant starts failing
    const inventory = await service.refresh();
    expect(inventory.problems[0]).toContain('HTTP 500');
    expect(inventory.workspaces.find((w) => w.name === 'la-g')?.missing).toBe(false);
  });

  it('applies the new-workspace default once, reports new workspaces and assigns stable alias numbers', async () => {
    const { service, config, onNewWorkspaces } = setup({
      [HOME]: [ws('la-a', HOME), ws('la-f', CUSTOMER)],
    });
    await service.refresh();
    expect(onNewWorkspaces).toHaveBeenCalledWith(2);
    const { config: stored } = await config.read();
    expect(Object.values(stored.workspaces).every((w) => w.enabled === true)).toBe(true);
    const numbers = Object.fromEntries(
      Object.entries(stored.tenants).map(([id, t]) => [id, t.aliasNumber]),
    );
    expect(new Set(Object.values(numbers)).size).toBe(Object.keys(numbers).length);

    onNewWorkspaces.mockClear();
    await service.refresh();
    expect(onNewWorkspaces).not.toHaveBeenCalled();
    const { config: again } = await config.read();
    expect(
      Object.fromEntries(Object.entries(again.tenants).map(([id, t]) => [id, t.aliasNumber])),
    ).toEqual(numbers);
  });

  it('updates workspaces and tenants, and forgets only missing workspaces', async () => {
    const rows = { [HOME]: [ws('la-a', HOME), ws('la-b', HOME)] };
    const { service } = setup(rows);
    const first = await service.refresh();
    const [a, b] = first.workspaces;
    let inventory = await service.updateWorkspaces({
      resourceIds: [a!.resourceId],
      enabled: false,
      alias: 'Prod',
      tags: ['tier1'],
    });
    expect(inventory.workspaces.find((w) => w.resourceId === a!.resourceId)).toMatchObject({
      enabled: false,
      alias: 'Prod',
      tags: ['tier1'],
    });
    inventory = await service.updateWorkspaces({ resourceIds: [a!.resourceId], alias: null });
    expect(inventory.workspaces.find((w) => w.resourceId === a!.resourceId)?.alias).toBeUndefined();

    inventory = await service.updateTenant({ tenantId: HOME, alias: 'Home SOC', tags: ['ch'] });
    expect(inventory.tenants.find((t) => t.tenantId === HOME)).toMatchObject({
      alias: 'Home SOC',
      tags: ['ch'],
    });

    rows[HOME] = [ws('la-a', HOME)];
    await service.refresh();
    inventory = await service.updateWorkspaces({
      resourceIds: [a!.resourceId, b!.resourceId],
      remove: true,
    });
    expect(inventory.workspaces.map((w) => w.name)).toEqual(['la-a']);
  });

  it('falls back to the onboarding-state check only for workspaces the solution query missed', async () => {
    const { service, source } = setup({
      [HOME]: [ws('la-flagged', HOME), ws('la-onboarded', HOME), ws('la-plain', HOME)],
    });
    const hasSentinel = vi.fn((id: string, _token: string) =>
      Promise.resolve(id.endsWith('la-onboarded')),
    );
    source.hasSentinel = hasSentinel;
    const inventory = await service.refresh();
    const byName = Object.fromEntries(inventory.workspaces.map((w) => [w.name, w.sentinel]));
    expect(byName).toEqual({ 'la-flagged': true, 'la-onboarded': true, 'la-plain': false });
    expect(hasSentinel.mock.calls.map(([id]) => id.split('/').pop())).toEqual([
      'la-onboarded',
      'la-plain',
    ]);
    expect(hasSentinel.mock.calls.every(([, token]) => token === 't')).toBe(true);
  });

  it('shares one run between concurrent refreshes', async () => {
    const { service, source } = setup({ [HOME]: [ws('la-a', HOME)] });
    await Promise.all([service.refresh(), service.refresh()]);
    expect(
      vi.mocked(source.query).mock.calls.filter(([kind]) => kind === 'workspaces'),
    ).toHaveLength(2); // home + guest
  });

  it('gives account tenants alias numbers before discovery runs', async () => {
    const { service } = setup({});
    await service.init();
    service.syncTenants(accounts());
    const tenants = service.snapshot().tenants;
    expect(tenants.map((t) => t.tenantId).sort()).toEqual([HOME, GUEST, CUSTOMER].sort());
    expect(new Set(tenants.map((t) => t.aliasNumber)).size).toBe(3);
  });
});

describe('demo inventory', () => {
  it('has 6 tenants and 12 workspaces once every demo tenant is signed in (spec 04)', async () => {
    const demoAccounts: AccountsSnapshot = {
      builtinAvailable: true,
      persistence: 'encrypted',
      accounts: [
        {
          id: 'demo:analyst@contoso.example',
          username: 'analyst@contoso.example',
          provider: 'demo',
          homeTenantId: DEMO_TENANTS.contoso.tenantId,
          refreshing: false,
          tenants: [
            { tenantId: DEMO_TENANTS.contoso.tenantId, relation: 'home', state: 'ok' },
            { tenantId: DEMO_TENANTS.northwind.tenantId, relation: 'guest', state: 'ok' },
          ],
        },
        {
          id: 'demo:guest@woodgrove.example',
          username: 'guest@woodgrove.example',
          provider: 'demo',
          homeTenantId: DEMO_TENANTS.woodgrove.tenantId,
          refreshing: false,
          tenants: [{ tenantId: DEMO_TENANTS.woodgrove.tenantId, relation: 'home', state: 'ok' }],
        },
      ],
    };
    const service = new DiscoveryService({
      auth: {
        snapshot: () => demoAccounts,
        getToken: () => Promise.resolve({ token: 'demo', expiresOn: new Date(10 ** 13) }),
      },
      source: {
        query: (kind, { accountId, tenantId }) =>
          Promise.resolve(demoDiscoveryRows(kind, accountId, tenantId)),
        tenantNames: () => DEMO_TENANT_NAMES,
      },
      config: new MemoryWorkspacesConfig(),
      cache: new MemoryInventoryCache(),
      newWorkspaceDefault: () => 'enabled',
      onChange: vi.fn(),
      onNewWorkspaces: vi.fn(),
    });
    const inventory = await service.refresh();
    expect(inventory.workspaces).toHaveLength(12);
    expect(new Set(inventory.workspaces.map((w) => w.tenantId)).size).toBe(6);
    expect(inventory.workspaces.filter((w) => !w.sentinel).length).toBeGreaterThan(0);
    expect(
      inventory.workspaces.find((w) => w.name === 'la-woodgrove-sentinel')?.paths,
    ).toHaveLength(2);
    expect(inventory.workspaces.every((w) => w.tenantId.startsWith('00000000-'))).toBe(true);
  });
});
