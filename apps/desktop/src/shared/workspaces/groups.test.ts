import { describe, expect, it } from 'vitest';

import { matchesGroup, resolveGroup } from './groups';
import type { InventoryTenant, Workspace } from './models';

const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000b2';

const workspace = (name: string, tenantId: string, extra: Partial<Workspace> = {}): Workspace => ({
  resourceId: `/subscriptions/s/workspaces/${name}`,
  name,
  customerId: name,
  location: 'westeurope',
  tenantId,
  subscriptionId: 's',
  resourceGroup: 'rg',
  sentinel: false,
  paths: [{ accountId: 'acc', authorityTenantId: T1, via: 'home' }],
  missing: false,
  enabled: true,
  tags: [],
  ...extra,
});

const tenants: InventoryTenant[] = [
  { tenantId: T1, tags: ['bank', 'ch'], aliasNumber: 1 },
  { tenantId: T2, tags: ['bank'], aliasNumber: 2 },
];
const WS = [
  workspace('la-t1-sentinel', T1, { sentinel: true }),
  workspace('la-t1-apps', T1),
  workspace('la-t2-sentinel', T2, { sentinel: true, tags: ['tier1'] }),
  workspace('la-t2-disabled', T2, { sentinel: true, enabled: false }),
  workspace('la-t2-missing', T2, { sentinel: true, missing: true }),
];
const names = (ids: string[]): string[] => ids.map((id) => id.split('/').pop() ?? '');

describe('groups', () => {
  it('dynamic groups match all conditions by default', () => {
    const group = {
      id: 'g',
      name: 'g',
      type: 'dynamic' as const,
      match: { sentinel: true, tenantTags: ['bank', 'ch'] },
    };
    expect(names(resolveGroup(group, WS, tenants))).toEqual(['la-t1-sentinel']);
  });

  it('mode "any" matches any condition and any tag', () => {
    const group = {
      id: 'g',
      name: 'g',
      type: 'dynamic' as const,
      match: { workspaceTags: ['tier1'], nameRegex: 'apps$', mode: 'any' as const },
    };
    expect(names(resolveGroup(group, WS, tenants))).toEqual(['la-t1-apps', 'la-t2-sentinel']);
  });

  it('only ever resolves to enabled, present workspaces', () => {
    const sentinel = { id: 'g', name: 'g', type: 'dynamic' as const, match: { sentinel: true } };
    expect(names(resolveGroup(sentinel, WS, tenants))).toEqual([
      'la-t1-sentinel',
      'la-t2-sentinel',
    ]);
    const fixed = {
      id: 's',
      name: 's',
      type: 'static' as const,
      workspaces: WS.map((w) => w.resourceId.toUpperCase()),
    };
    expect(names(resolveGroup(fixed, WS, tenants))).toEqual([
      'la-t1-sentinel',
      'la-t1-apps',
      'la-t2-sentinel',
    ]);
  });

  it('matches tenant ids, location and accounts; invalid regex matches nothing', () => {
    const w = WS[0]!;
    expect(matchesGroup({ tenantIds: [T1.toUpperCase()] }, w, tenants[0])).toBe(true);
    expect(matchesGroup({ location: 'WestEurope' }, w, tenants[0])).toBe(true);
    expect(matchesGroup({ accountIds: ['other'] }, w, tenants[0])).toBe(false);
    expect(matchesGroup({ nameRegex: '(' }, w, tenants[0])).toBe(false);
    expect(matchesGroup({}, w, tenants[0])).toBe(true);
  });
});
