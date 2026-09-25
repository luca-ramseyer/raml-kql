import { describe, expect, it } from 'vitest';

import { DisplayNamer, formatAutoAlias, type AliasScope } from './aliasing';

const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000b2';
const ALL = new Set<AliasScope>(['tenant', 'subscription', 'workspace', 'account']);

const tenants = [
  { tenantId: T1, displayName: 'Contoso', aliasNumber: 7 },
  { tenantId: T2, displayName: 'Fabrikam', alias: 'Bank A', aliasNumber: 2 },
];
const workspaces = [
  {
    resourceId: '/s/1/w/b',
    name: 'la-b',
    tenantId: T1,
    subscriptionId: 'S1',
    subscriptionName: 'Prod',
  },
  {
    resourceId: '/s/1/w/a',
    name: 'la-a',
    tenantId: T1,
    subscriptionId: 'S1',
    subscriptionName: 'Prod',
  },
  { resourceId: '/s/2/w/c', name: 'la-c', tenantId: T2, subscriptionId: 'S2', alias: 'Main' },
];

describe('aliasing', () => {
  it('formats automatic aliases', () => {
    expect(formatAutoAlias('Customer {nn}', 7)).toBe('Customer 07');
    expect(formatAutoAlias('C{nnn}/{n}', 7)).toBe('C007/7');
  });

  it('aliases every scope while active, using user aliases first', () => {
    const namer = new DisplayNamer(
      { active: true, format: 'Customer {nn}', scope: ALL },
      tenants,
      workspaces,
      ['acc-a', 'acc-b'],
    );
    expect(namer.tenant(T1)).toBe('Customer 07');
    expect(namer.tenant(T2)).toBe('Bank A');
    expect(namer.workspace(workspaces[1]!)).toBe('Customer 07 · Workspace 01');
    expect(namer.workspace(workspaces[0]!)).toBe('Customer 07 · Workspace 02');
    expect(namer.workspace(workspaces[2]!)).toBe('Main');
    expect(namer.subscription(workspaces[0]!)).toBe('Customer 07 · Subscription 01');
    expect(namer.account('acc-b', 'someone@fabrikam.example')).toBe('Account 2');
  });

  it('never falls back to a real name for tenants it does not know', () => {
    const namer = new DisplayNamer({ active: true, format: 'Customer {nn}', scope: ALL }, [], []);
    expect(
      namer.tenant('00000000-0000-0000-0000-0000000000ff', { displayName: 'Secret Corp' }),
    ).toBe('Unlisted tenant');
  });

  it('shows real names when inactive or out of scope', () => {
    const off = new DisplayNamer(
      { active: false, format: 'Customer {nn}', scope: ALL },
      tenants,
      workspaces,
    );
    expect(off.tenant(T1)).toBe('Contoso');
    expect(off.workspace(workspaces[0]!)).toBe('la-b');
    expect(off.subscription(workspaces[0]!)).toBe('Prod');
    const tenantOnly = new DisplayNamer(
      { active: true, format: 'Customer {nn}', scope: new Set(['tenant']) },
      tenants,
      workspaces,
    );
    expect(tenantOnly.workspace(workspaces[0]!)).toBe('la-b');
    expect(tenantOnly.tenant(T1)).toBe('Customer 07');
  });
});
