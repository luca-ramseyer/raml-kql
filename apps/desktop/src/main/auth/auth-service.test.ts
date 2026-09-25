import { describe, expect, it, vi } from 'vitest';

import type { AccountsSnapshot } from '../../shared/auth/models';
import { AppError } from '../../shared/errors';

import { MemoryAccountsConfig } from './accounts-config';
import { AuthService, type AuthProviders } from './auth-service';
import { PUBLIC_CLOUD } from './cloud';
import { DEMO_TENANTS, DemoAuthProvider } from './demo-provider';
import {
  InteractionRequiredError,
  NoAccessError,
  type AuthProvider,
  type ProviderAccount,
} from './provider';

const HOME = '00000000-0000-0000-0000-0000000000a1';
const GUEST = '00000000-0000-0000-0000-0000000000b2';
const NOPE = '00000000-0000-0000-0000-0000000000c3';

const ACCOUNT: ProviderAccount = {
  id: 'oid.home',
  username: 'analyst@contoso.example',
  homeTenantId: HOME,
  provider: 'builtin',
};

/** A fake MSAL-like provider with scripted per-tenant behaviour. */
function fakeProvider(
  behaviour: Record<string, 'ok' | 'mfa' | 'noAccess'> = {},
  kind: AuthProvider['kind'] = 'builtin',
) {
  const state: { accounts: ProviderAccount[] } = { accounts: [] };
  const provider = {
    kind,
    get accounts(): ProviderAccount[] {
      return state.accounts;
    },
    set accounts(value: ProviderAccount[]) {
      state.accounts = value;
    },
    listAccounts: vi.fn(() => Promise.resolve(state.accounts)),
    signIn: vi.fn(() => {
      state.accounts = [ACCOUNT];
      return Promise.resolve(ACCOUNT);
    }),
    signOut: vi.fn(() => Promise.resolve()),
    acquireTokenSilent: vi.fn((_account: string, tenant: string, scope: string) => {
      const mode = behaviour[tenant] ?? 'ok';
      if (mode === 'mfa') return Promise.reject(new InteractionRequiredError('mfa', 'AADSTS50076'));
      if (mode === 'noAccess') return Promise.reject(new NoAccessError('AADSTS50020: no access'));
      return Promise.resolve({
        token: `token:${tenant}:${scope}`,
        expiresOn: new Date(Date.now() + 3600_000),
      });
    }),
    acquireTokenInteractive: vi.fn((_account: string, tenant: string) => {
      behaviour[tenant] = 'ok';
      return Promise.resolve({ token: 'interactive', expiresOn: new Date(Date.now() + 3600_000) });
    }),
  } satisfies AuthProvider & { accounts: ProviderAccount[] };
  return provider;
}

function service(
  providers: AuthProviders,
  options: Partial<ConstructorParameters<typeof AuthService>[0]> = {},
) {
  const snapshots: AccountsSnapshot[] = [];
  const auth = new AuthService({
    cloud: PUBLIC_CLOUD,
    providers,
    persistence: 'encrypted',
    config: new MemoryAccountsConfig(),
    listTenants: () =>
      Promise.resolve([
        { tenantId: HOME, relation: 'home', displayName: 'Contoso' },
        { tenantId: GUEST, relation: 'guest', displayName: 'Northwind' },
        { tenantId: NOPE, relation: 'guest', displayName: 'Tailspin' },
      ]),
    onChange: (snapshot) => snapshots.push(snapshot),
    onDeviceCode: vi.fn(),
    ...options,
  });
  return { auth, snapshots };
}

describe('AuthService token routing (spec 02)', () => {
  it('uses the tenant as authority and the resource scope, and caches per (account, tenant, resource)', async () => {
    const provider = fakeProvider();
    const { auth } = service({ builtin: provider });
    await auth.addAccount({ method: 'browser' });
    provider.acquireTokenSilent.mockClear();

    const token = await auth.getToken({
      accountId: ACCOUNT.id,
      tenantId: GUEST,
      resource: 'logAnalytics',
    });
    expect(token.token).toBe(`token:${GUEST}:https://api.loganalytics.io/Data.Read`);
    await auth.getToken({ accountId: ACCOUNT.id, tenantId: GUEST, resource: 'logAnalytics' });
    // The ARM token for this tenant was already fetched (and cached) by the tenant probe.
    await auth.getToken({ accountId: ACCOUNT.id, tenantId: GUEST, resource: 'arm' });
    expect(provider.acquireTokenSilent.mock.calls).toEqual([
      [ACCOUNT.id, GUEST, 'https://api.loganalytics.io/Data.Read', { forceRefresh: false }],
    ]);

    // After a 401 the engine forces a refresh past every cache.
    await auth.getToken({
      accountId: ACCOUNT.id,
      tenantId: GUEST,
      resource: 'logAnalytics',
      forceRefresh: true,
    });
    expect(provider.acquireTokenSilent.mock.calls.at(-1)).toEqual([
      ACCOUNT.id,
      GUEST,
      'https://api.loganalytics.io/Data.Read',
      { forceRefresh: true },
    ]);
  });

  it('marks needsReauth and fails with AUTH_INTERACTION_REQUIRED instead of popping a browser', async () => {
    const provider = fakeProvider({ [GUEST]: 'mfa' });
    const { auth } = service({ builtin: provider });
    await auth.addAccount({ method: 'browser' });
    await expect(
      auth.getToken({ accountId: ACCOUNT.id, tenantId: GUEST, resource: 'logAnalytics' }),
    ).rejects.toMatchObject({ code: 'AUTH_INTERACTION_REQUIRED' });
    expect(provider.acquireTokenInteractive).not.toHaveBeenCalled();
    expect(auth.tenantsNeedingReauth()).toEqual([{ accountId: ACCOUNT.id, tenantId: GUEST }]);
  });

  it('coalesces concurrent token requests', async () => {
    const provider = fakeProvider();
    const { auth } = service({ builtin: provider });
    await auth.addAccount({ method: 'browser' });
    provider.acquireTokenSilent.mockClear();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        auth.getToken({ accountId: ACCOUNT.id, tenantId: HOME, resource: 'logAnalytics' }),
      ),
    );
    expect(provider.acquireTokenSilent).toHaveBeenCalledOnce();
  });

  it('rejects unknown accounts', async () => {
    const { auth } = service({ builtin: fakeProvider() });
    await expect(
      auth.getToken({ accountId: 'nope', tenantId: HOME, resource: 'arm' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
  });
});

describe('AuthService tenants and accounts', () => {
  it('enumerates tenants and probes each: ok / needsReauth / noAccess', async () => {
    const provider = fakeProvider({ [GUEST]: 'mfa', [NOPE]: 'noAccess' });
    const { auth } = service({ builtin: provider });
    const snapshot = await auth.addAccount({ method: 'browser' });
    const [account] = snapshot.accounts;
    expect(account?.refreshing).toBe(false);
    expect(account?.tenants.map((t) => [t.displayName, t.relation, t.state])).toEqual([
      ['Contoso', 'home', 'ok'],
      ['Northwind', 'guest', 'needsReauth'],
      ['Tailspin', 'guest', 'noAccess'],
    ]);
  });

  it('keeps the home tenant when /tenants fails', async () => {
    const { auth } = service(
      { builtin: fakeProvider() },
      { listTenants: () => Promise.reject(new Error('HTTP 500')) },
    );
    const snapshot = await auth.addAccount({ method: 'browser' });
    expect(snapshot.accounts[0]?.tenants).toEqual([
      expect.objectContaining({ tenantId: HOME, relation: 'home', state: 'ok' }),
    ]);
  });

  it('marks the home tenant needsReauth when even the home token needs interaction', async () => {
    const { auth } = service({ builtin: fakeProvider({ [HOME]: 'mfa' }) });
    const snapshot = await auth.addAccount({ method: 'browser' });
    expect(snapshot.accounts[0]?.tenants).toEqual([
      expect.objectContaining({ tenantId: HOME, state: 'needsReauth' }),
    ]);
  });

  it('reauthenticate signs in interactively for that tenant, then re-checks', async () => {
    const provider = fakeProvider({ [GUEST]: 'mfa' });
    const { auth } = service({ builtin: provider });
    await auth.addAccount({ method: 'browser' });
    const snapshot = await auth.reauthenticate(ACCOUNT.id, GUEST);
    expect(provider.acquireTokenInteractive).toHaveBeenCalledWith(
      ACCOUNT.id,
      GUEST,
      'https://management.azure.com/user_impersonation',
    );
    expect(snapshot.accounts[0]?.tenants.find((t) => t.tenantId === GUEST)?.state).toBe('ok');
    expect(auth.tenantsNeedingReauth()).toEqual([]);
  });

  it('sign-out removes the account and its tokens immediately', async () => {
    const provider = fakeProvider();
    const config = new MemoryAccountsConfig();
    const { auth } = service({ builtin: provider }, { config });
    await auth.addAccount({ method: 'browser' });
    const snapshot = await auth.removeAccount(ACCOUNT.id);
    expect(snapshot.accounts).toEqual([]);
    expect(provider.signOut).toHaveBeenCalledWith(ACCOUNT.id);
    expect(await config.read()).toEqual([]);
    await expect(
      auth.getToken({ accountId: ACCOUNT.id, tenantId: HOME, resource: 'arm' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('stores labels in the accounts config without tokens', async () => {
    const config = new MemoryAccountsConfig();
    const { auth } = service({ builtin: fakeProvider() }, { config });
    await auth.addAccount({ method: 'browser' });
    const snapshot = await auth.setLabel(ACCOUNT.id, '  Work  ');
    expect(snapshot.accounts[0]?.label).toBe('Work');
    expect(await config.read()).toEqual([
      { id: ACCOUNT.id, provider: 'builtin', username: ACCOUNT.username, label: 'Work' },
    ]);
    expect(JSON.stringify(await config.read())).not.toContain('token');
    await auth.setLabel(ACCOUNT.id, null);
    expect((await config.read())[0]?.label).toBeUndefined();
  });

  it('refuses a second sign-in while one is running', async () => {
    const provider = fakeProvider();
    let finish: () => void = () => undefined;
    provider.signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(ACCOUNT);
          };
        }),
    );
    const { auth } = service({ builtin: provider });
    const first = auth.addAccount({ method: 'browser' });
    await expect(auth.addAccount({ method: 'browser' })).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    finish();
    await first;
  });

  it('explains missing prerequisites', async () => {
    await expect(service({}).auth.addAccount({ method: 'browser' })).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      message: expect.stringMatching(/no built-in client ID/) as unknown,
    });
    await expect(
      service({ builtin: fakeProvider() }, { persistence: 'unavailable' }).auth.addAccount({
        method: 'browser',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      message: expect.stringMatching(/keyring/) as unknown,
    });
  });

  it('creates one provider per custom client ID and remembers it in the config', async () => {
    const custom = fakeProvider();
    const factory = vi.fn(() => custom);
    const config = new MemoryAccountsConfig();
    const { auth } = service({ custom: factory }, { config });
    const clientId = '00000000-0000-0000-0000-00000000dead';
    await auth.addAccount({ method: 'custom', clientId, flow: 'browser' });
    expect(factory).toHaveBeenCalledWith(clientId);
    expect((await config.read())[0]).toMatchObject({ clientId });

    // After a restart the custom provider is recreated from accounts.jsonc.
    const restarted = service({ custom: factory }, { config });
    const snapshot = await restarted.auth.init();
    expect(snapshot.accounts.map((a) => a.id)).toEqual([ACCOUNT.id]);
  });

  it('only lists Azure CLI accounts the user added', async () => {
    const cli = fakeProvider({}, 'azureCli');
    cli.accounts = [{ ...ACCOUNT, id: 'azcli:analyst@contoso.example', provider: 'azureCli' }];
    expect((await service({ azureCli: cli }).auth.init()).accounts).toEqual([]);

    const config = new MemoryAccountsConfig();
    await config.write([{ id: 'azcli:analyst@contoso.example', provider: 'azureCli' }]);
    expect((await service({ azureCli: cli }, { config }).auth.init()).accounts).toHaveLength(1);
  });
});

describe('AuthService in demo mode', () => {
  it('shows 2 accounts with 3 tenants, one needing sign-in (Phase 2 acceptance)', async () => {
    const demo = new DemoAuthProvider();
    const { auth } = service(
      { demo },
      { listTenants: (account) => Promise.resolve(demo.tenantsFor(account.id)) },
    );
    await auth.init();
    await auth.refresh();
    const { accounts } = auth.snapshot();
    expect(accounts.map((a) => a.username)).toEqual([
      'analyst@contoso.example',
      'guest@woodgrove.example',
    ]);
    const tenants = accounts.flatMap((a) => a.tenants);
    expect(tenants.map((t) => t.displayName)).toEqual([
      'Contoso',
      'Northwind Traders',
      'Woodgrove Bank',
    ]);
    expect(tenants.find((t) => t.tenantId === DEMO_TENANTS.northwind.tenantId)?.state).toBe(
      'needsReauth',
    );
    expect(tenants.every((t) => t.tenantId.startsWith('00000000-'))).toBe(true);

    await auth.reauthenticate('demo:analyst@contoso.example', DEMO_TENANTS.northwind.tenantId);
    expect(auth.tenantsNeedingReauth()).toEqual([]);
  });
});
