import { describe, expect, it } from 'vitest';

import type { ResultColumn } from '../query/models';

import { displayNameMapper } from './display-names';

const columns: ResultColumn[] = [
  { name: '_TenantName', type: 'string', attribution: true },
  { name: '_TenantId', type: 'string', attribution: true },
  { name: 'UserPrincipalName', type: 'string' },
  { name: 'Details', type: 'dynamic' },
  { name: 'Count', type: 'long' },
];

const T1 = '00000000-0000-0000-0000-00000000c001';

describe('displayNameMapper', () => {
  it('aliases attribution columns and masks the other cells', () => {
    const map = displayNameMapper(columns, {
      tenants: { [T1]: 'Customer 01' },
      workspaces: {},
      accounts: {},
      masking: [{ match: 'fabrikam', replace: 'customer01' }],
    });
    expect(map(['Fabrikam', T1, 'alice@fabrikam.com', { domain: 'fabrikam.com' }, 3])).toEqual([
      'Customer 01',
      T1,
      'alice@customer01.com',
      { domain: 'customer01.com' },
      3,
    ]);
  });

  it('leaves rows untouched when real names are shown', () => {
    const row = ['Fabrikam', T1, 'alice@fabrikam.com', null, 1];
    expect(displayNameMapper(columns, undefined)(row)).toBe(row);
  });
});
