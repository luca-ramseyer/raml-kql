import { DEMO_TENANTS } from '../auth/demo-provider';
import type { DiscoveryQueryKind } from '../azure/resource-graph';
import type { DiscoveredTenant } from '../discovery/inventory-cache';

/**
 * Demo inventory (spec 04, "Demo mode"): 6 tenants and 12 workspaces, some without Sentinel.
 * The analyst account reaches Contoso (home), Northwind (guest, needs sign-in first) and three
 * Lighthouse customers; the Woodgrove guest account reaches Woodgrove, and one Woodgrove
 * workspace is also delegated to Contoso via Lighthouse (two access paths).
 * `behaviour` flags drive the fake query engine in later phases.
 */
export const DEMO_EXTRA_TENANTS = {
  fabrikam: {
    tenantId: '00000000-0000-0000-0000-00000000c004',
    displayName: 'Fabrikam',
    defaultDomain: 'fabrikam.example',
  },
  adventureWorks: {
    tenantId: '00000000-0000-0000-0000-00000000c005',
    displayName: 'Adventure Works',
    defaultDomain: 'adventure-works.example',
  },
  tailspin: {
    tenantId: '00000000-0000-0000-0000-00000000c006',
    displayName: 'Tailspin Toys',
    defaultDomain: 'tailspin.example',
  },
} as const;

export type DemoBehaviour = 'normal' | 'alwaysForbidden' | 'slow' | 'throttleOnce';

export interface DemoWorkspace {
  name: string;
  tenantId: string;
  subscriptionId: string;
  subscriptionName: string;
  location: string;
  sentinel: boolean;
  behaviour: DemoBehaviour;
  /** Which (account, authority tenant) pairs can see it. */
  visibleTo: { accountId: string; tenantId: string }[];
}

const ANALYST = 'demo:analyst@contoso.example';
const GUEST = 'demo:guest@woodgrove.example';
const viaContoso = [{ accountId: ANALYST, tenantId: DEMO_TENANTS.contoso.tenantId }];

const sub = (n: number): string =>
  `00000000-0000-0000-0000-0000000005${String(n).padStart(2, '0')}`;

export const DEMO_WORKSPACES: DemoWorkspace[] = [
  {
    name: 'la-contoso-soc',
    tenantId: DEMO_TENANTS.contoso.tenantId,
    subscriptionId: sub(1),
    subscriptionName: 'SOC-Prod',
    location: 'westeurope',
    sentinel: true,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-contoso-identity',
    tenantId: DEMO_TENANTS.contoso.tenantId,
    subscriptionId: sub(1),
    subscriptionName: 'SOC-Prod',
    location: 'westeurope',
    sentinel: true,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-contoso-apps',
    tenantId: DEMO_TENANTS.contoso.tenantId,
    subscriptionId: sub(2),
    subscriptionName: 'Apps',
    location: 'switzerlandnorth',
    sentinel: false,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-northwind-sentinel',
    tenantId: DEMO_TENANTS.northwind.tenantId,
    subscriptionId: sub(3),
    subscriptionName: 'Northwind-Security',
    location: 'northeurope',
    sentinel: true,
    behaviour: 'normal',
    visibleTo: [{ accountId: ANALYST, tenantId: DEMO_TENANTS.northwind.tenantId }],
  },
  {
    name: 'la-fabrikam-sentinel',
    tenantId: DEMO_EXTRA_TENANTS.fabrikam.tenantId,
    subscriptionId: sub(4),
    subscriptionName: 'Fabrikam-Security',
    location: 'northeurope',
    sentinel: true,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-fabrikam-apps',
    tenantId: DEMO_EXTRA_TENANTS.fabrikam.tenantId,
    subscriptionId: sub(4),
    subscriptionName: 'Fabrikam-Security',
    location: 'northeurope',
    sentinel: false,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-adventureworks-soc',
    tenantId: DEMO_EXTRA_TENANTS.adventureWorks.tenantId,
    subscriptionId: sub(5),
    subscriptionName: 'AW-Security',
    location: 'eastus',
    sentinel: true,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-adventureworks-dev',
    tenantId: DEMO_EXTRA_TENANTS.adventureWorks.tenantId,
    subscriptionId: sub(6),
    subscriptionName: 'AW-Dev',
    location: 'eastus',
    sentinel: false,
    behaviour: 'slow',
    visibleTo: viaContoso,
  },
  {
    name: 'la-tailspin-sentinel',
    tenantId: DEMO_EXTRA_TENANTS.tailspin.tenantId,
    subscriptionId: sub(7),
    subscriptionName: 'Tailspin-SecOps',
    location: 'uksouth',
    sentinel: true,
    behaviour: 'alwaysForbidden',
    visibleTo: viaContoso,
  },
  {
    name: 'la-tailspin-archive',
    tenantId: DEMO_EXTRA_TENANTS.tailspin.tenantId,
    subscriptionId: sub(7),
    subscriptionName: 'Tailspin-SecOps',
    location: 'uksouth',
    sentinel: false,
    behaviour: 'normal',
    visibleTo: viaContoso,
  },
  {
    name: 'la-woodgrove-sentinel',
    tenantId: DEMO_TENANTS.woodgrove.tenantId,
    subscriptionId: sub(8),
    subscriptionName: 'Woodgrove-SOC',
    location: 'switzerlandnorth',
    sentinel: true,
    behaviour: 'throttleOnce',
    visibleTo: [{ accountId: GUEST, tenantId: DEMO_TENANTS.woodgrove.tenantId }, ...viaContoso],
  },
  {
    name: 'la-woodgrove-eu',
    tenantId: DEMO_TENANTS.woodgrove.tenantId,
    subscriptionId: sub(9),
    subscriptionName: 'Woodgrove-EU',
    location: 'westeurope',
    sentinel: false,
    behaviour: 'normal',
    visibleTo: [{ accountId: GUEST, tenantId: DEMO_TENANTS.woodgrove.tenantId }],
  },
];

export function demoResourceId(workspace: DemoWorkspace): string {
  return `/subscriptions/${workspace.subscriptionId}/resourcegroups/rg-${workspace.name}/providers/microsoft.operationalinsights/workspaces/${workspace.name}`;
}

export function demoCustomerId(workspace: DemoWorkspace): string {
  const index = DEMO_WORKSPACES.indexOf(workspace) + 1;
  return `00000000-0000-0000-0000-0000000001${String(index).padStart(2, '0')}`;
}

/** Answers the discovery queries like Resource Graph would, for one (account, tenant) token. */
export function demoDiscoveryRows(
  kind: DiscoveryQueryKind,
  accountId: string,
  tenantId: string,
): Record<string, unknown>[] {
  const visible = DEMO_WORKSPACES.filter((w) =>
    w.visibleTo.some((v) => v.accountId === accountId && v.tenantId === tenantId),
  );
  switch (kind) {
    case 'workspaces':
      return visible.map((w) => ({
        id: demoResourceId(w),
        name: w.name,
        location: w.location,
        tenantId: w.tenantId,
        subscriptionId: w.subscriptionId,
        resourceGroup: `rg-${w.name}`,
        customerId: demoCustomerId(w),
        retentionInDays: 90,
        sku: 'PerGB2018',
      }));
    case 'subscriptions':
      return [...new Map(visible.map((w) => [w.subscriptionId, w])).values()].map((w) => ({
        subscriptionId: w.subscriptionId,
        subscriptionName: w.subscriptionName,
        tenantId: w.tenantId,
      }));
    case 'sentinel':
      return visible
        .filter((w) => w.sentinel)
        .map((w) => ({ workspaceResourceId: demoResourceId(w) }));
  }
}

export const DEMO_TENANT_NAMES: DiscoveredTenant[] = [
  ...Object.values(DEMO_TENANTS),
  ...Object.values(DEMO_EXTRA_TENANTS),
].map((t) => ({
  tenantId: t.tenantId,
  displayName: t.displayName,
  defaultDomain: t.defaultDomain,
}));
