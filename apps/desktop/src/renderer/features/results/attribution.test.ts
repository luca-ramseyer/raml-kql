import { describe, expect, it } from 'vitest';

import { DisplayNamer } from '../../../shared/privacy/aliasing';
import { ATTRIBUTION_COLUMNS, type ResultColumn } from '../../../shared/query/models';
import type { Workspace } from '../../../shared/workspaces/models';

import { formatValue, makeCellFormatter, visibleColumnIndexes } from './attribution';

const TENANT = '00000000-0000-0000-0000-00000000c001';
const WORKSPACE = {
  resourceId:
    '/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la-contoso-soc',
  name: 'la-contoso-soc',
  customerId: '00000000-0000-0000-0000-000000000101',
  tenantId: TENANT,
  subscriptionId: '00000000-0000-0000-0000-000000000501',
  subscriptionName: 'SOC-Prod',
} as Workspace;

const COLUMNS: ResultColumn[] = [
  ...ATTRIBUTION_COLUMNS.map((name) => ({ name, type: 'string' as const, attribution: true })),
  { name: 'Computer', type: 'string' },
  { name: 'Details', type: 'dynamic' },
];
const ROW = [
  'Contoso',
  TENANT,
  'SOC-Prod',
  'la-contoso-soc',
  WORKSPACE.customerId,
  'analyst@contoso.example',
  'ws-001',
  { a: 1 },
];

function namer(active: boolean): DisplayNamer {
  return new DisplayNamer(
    {
      active,
      format: 'Customer {nn}',
      scope: new Set(['tenant', 'subscription', 'workspace', 'account']),
    },
    [{ tenantId: TENANT, displayName: 'Contoso', aliasNumber: 1 }],
    [WORKSPACE],
    ['demo:analyst'],
  );
}

describe('attribution cells', () => {
  const accountIds = new Map([['analyst@contoso.example', 'demo:analyst']]);

  it('show aliases in presentation mode', () => {
    const format = makeCellFormatter(COLUMNS, {
      namer: namer(true),
      workspaces: [WORKSPACE],
      accountIds,
    });
    expect(COLUMNS.map((_, i) => format(ROW, i))).toEqual([
      'Customer 01',
      TENANT,
      'Customer 01 · Subscription 01',
      'Customer 01 · Workspace 01',
      WORKSPACE.customerId,
      'Account 1',
      'ws-001',
      '{"a":1}',
    ]);
  });

  it('show real names otherwise', () => {
    const format = makeCellFormatter(COLUMNS, {
      namer: namer(false),
      workspaces: [WORKSPACE],
      accountIds,
    });
    expect([0, 2, 3, 5].map((i) => format(ROW, i))).toEqual([
      'Contoso',
      'SOC-Prod',
      'la-contoso-soc',
      'analyst@contoso.example',
    ]);
  });

  it('never leak names of workspaces or accounts the inventory no longer has', () => {
    const format = makeCellFormatter(COLUMNS, {
      namer: namer(true),
      workspaces: [],
      accountIds: new Map(),
    });
    expect([2, 3, 5].map((i) => format(ROW, i))).toEqual([
      'Unlisted subscription',
      'Unlisted workspace',
      'Account',
    ]);
  });

  it('hides attribution columns that are not enabled', () => {
    expect(visibleColumnIndexes(COLUMNS, ['_TenantName', '_WorkspaceName'])).toEqual([0, 3, 6, 7]);
  });

  it('formats plain values', () => {
    expect([null, undefined, 3, true, 'x', [1]].map(formatValue)).toEqual([
      '',
      '',
      '3',
      'true',
      'x',
      '[1]',
    ]);
  });
});
