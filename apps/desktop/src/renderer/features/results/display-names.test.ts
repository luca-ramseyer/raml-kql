import { describe, expect, it } from 'vitest';

import { DisplayNamer } from '../../../shared/privacy/aliasing';
import type { Workspace } from '../../../shared/workspaces/models';

import { buildDisplayNames } from './display-names';

const TENANT = '00000000-0000-0000-0000-00000000c001';
const WORKSPACE = {
  resourceId:
    '/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la',
  name: 'la-contoso',
  customerId: '00000000-0000-0000-0000-0000000001AB',
  tenantId: TENANT,
  subscriptionId: '00000000-0000-0000-0000-000000000501',
} as Workspace;

const namer = (active: boolean) =>
  new DisplayNamer(
    {
      active,
      format: 'Customer {nn}',
      scope: new Set(['tenant', 'subscription', 'workspace', 'account']),
    },
    [{ tenantId: TENANT, displayName: 'Contoso', aliasNumber: 3 }],
    [WORKSPACE],
    ['demo:a'],
  );

describe('buildDisplayNames', () => {
  it('maps attribution values to aliases while aliased', () => {
    expect(
      buildDisplayNames(
        namer(true),
        [WORKSPACE],
        [{ id: 'demo:a', username: 'a@contoso.example' }],
      ),
    ).toEqual({
      tenants: { [TENANT]: 'Customer 03' },
      workspaces: {
        '00000000-0000-0000-0000-0000000001ab': {
          workspace: 'Customer 03 · Workspace 01',
          subscription: 'Customer 03 · Subscription 01',
        },
      },
      accounts: { 'a@contoso.example': 'Account 1' },
    });
  });

  it('is undefined when real names are shown', () => {
    expect(buildDisplayNames(namer(false), [WORKSPACE], [])).toBeUndefined();
  });
});
