import { InteractionRequiredAuthError } from '@azure/msal-node';
import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_CLOUD } from './cloud';
import { mapMsalError, MsalAuthProvider, type MsalClient } from './msal-provider';
import { InteractionRequiredError, NoAccessError } from './provider';

const CLIENT = '00000000-0000-0000-0000-00000000c11e';
const TENANT = '00000000-0000-0000-0000-0000000000b2';

describe('mapMsalError', () => {
  it('maps interaction-required errors (MFA, CA, consent)', () => {
    // As MSAL 7 builds it from a server response: the Entra code arrives in `errorNo`.
    const error = new InteractionRequiredAuthError(
      'interaction_required',
      'Due to a configuration change...',
      '',
      '',
      '',
      '',
      '',
      '50076',
    );
    const mapped = mapMsalError(error, CLIENT, TENANT);
    expect(mapped).toBeInstanceOf(InteractionRequiredError);
    expect((mapped as InteractionRequiredError).reason).toBe('AADSTS50076');
  });

  it('maps "user not in tenant" to no access', () => {
    expect(
      mapMsalError(
        new Error('AADSTS50020: User account from identity provider does not exist'),
        CLIENT,
        TENANT,
      ),
    ).toBeInstanceOf(NoAccessError);
  });

  it('explains admin consent with the admin consent URL', () => {
    const mapped = mapMsalError(new Error('AADSTS90094: admin approval required'), CLIENT, TENANT);
    expect(mapped).toBeInstanceOf(NoAccessError);
    expect(mapped.message).toContain(
      `https://login.microsoftonline.com/${TENANT}/adminconsent?client_id=${CLIENT}`,
    );
  });

  it('keeps only the first line of unknown errors', () => {
    expect(mapMsalError(new Error('network down\nstack...'), CLIENT, TENANT).message).toBe(
      'Sign-in failed: network down',
    );
  });
});

describe('mapMsalError without an Entra code', () => {
  it('falls back to the MSAL error code as the reason', () => {
    const mapped = mapMsalError(
      new InteractionRequiredAuthError('consent_required', 'consent needed'),
      CLIENT,
      TENANT,
    );
    expect((mapped as InteractionRequiredError).reason).toBe('consent_required');
  });
});

describe('MsalAuthProvider', () => {
  const HOME = '00000000-0000-0000-0000-0000000000a1';
  const account = {
    homeAccountId: `11111111-1111-1111-1111-111111111111.${HOME}`,
    environment: 'login.microsoftonline.com',
    tenantId: HOME,
    username: 'analyst@contoso.example',
    localAccountId: '11111111-1111-1111-1111-111111111111',
  };
  const result = (token = 'at') => ({ accessToken: token, expiresOn: new Date(10 ** 13), account });

  function setup() {
    const cache = {
      getAllAccounts: vi.fn(() => Promise.resolve([account])),
      getAccountByHomeId: vi.fn((id: string) =>
        Promise.resolve(id === account.homeAccountId ? account : null),
      ),
      removeAccount: vi.fn(() => Promise.resolve()),
    };
    const client = {
      getTokenCache: () => cache,
      acquireTokenSilent: vi.fn(() => Promise.resolve(result())),
      acquireTokenInteractive: vi.fn(() => Promise.resolve(result('interactive'))),
      acquireTokenByDeviceCode: vi.fn((request: { deviceCodeCallback: (r: unknown) => void }) => {
        request.deviceCodeCallback({
          userCode: 'ABC',
          verificationUri: 'https://microsoft.com/devicelogin',
          message: 'Go there',
          expiresIn: 900,
        });
        return Promise.resolve(result());
      }),
    };
    let configuration: unknown;
    const openBrowser = vi.fn(() => Promise.resolve());
    const provider = new MsalAuthProvider({
      kind: 'builtin',
      clientId: CLIENT,
      cloud: PUBLIC_CLOUD,
      openBrowser,
      interactiveTimeoutMs: 50,
      createClient: (config) => {
        configuration = config;
        return client as unknown as MsalClient;
      },
    });
    return { provider, client, cache, openBrowser, configuration: () => configuration };
  }

  it('configures the organizations authority, CAE capability and no PII logging', () => {
    const { configuration } = setup();
    expect(configuration()).toMatchObject({
      auth: {
        clientId: CLIENT,
        authority: 'https://login.microsoftonline.com/organizations',
        clientCapabilities: ['cp1'],
      },
      system: { loggerOptions: { piiLoggingEnabled: false } },
    });
  });

  it('lists cached accounts with their home tenant', async () => {
    expect(await setup().provider.listAccounts()).toEqual([
      {
        id: account.homeAccountId,
        username: account.username,
        homeTenantId: HOME,
        provider: 'builtin',
      },
    ]);
  });

  it('signs in with the system browser, asking for ARM plus sign-in scopes', async () => {
    const { provider, client } = setup();
    await provider.signIn({ flow: 'browser' });
    expect(client.acquireTokenInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          'https://management.azure.com/user_impersonation',
          'openid',
          'profile',
          'offline_access',
        ],
        prompt: 'select_account',
      }),
    );
  });

  it('relays the device code to the UI', async () => {
    const onDeviceCode = vi.fn();
    await setup().provider.signIn({ flow: 'deviceCode', onDeviceCode });
    expect(onDeviceCode).toHaveBeenCalledWith({
      userCode: 'ABC',
      verificationUri: 'https://microsoft.com/devicelogin',
      message: 'Go there',
      expiresInSeconds: 900,
    });
  });

  it('gets silent tokens with the tenant as authority', async () => {
    const { provider, client } = setup();
    const token = await provider.acquireTokenSilent(
      account.homeAccountId,
      TENANT,
      'https://api.loganalytics.io/Data.Read',
    );
    expect(token.token).toBe('at');
    expect(client.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      scopes: ['https://api.loganalytics.io/Data.Read'],
      authority: `https://login.microsoftonline.com/${TENANT}`,
    });
    await provider.acquireTokenSilent(account.homeAccountId, TENANT, 's', { forceRefresh: true });
    expect(client.acquireTokenSilent).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it('treats accounts missing from the cache as needing sign-in', async () => {
    await expect(setup().provider.acquireTokenSilent('gone', TENANT, 's')).rejects.toBeInstanceOf(
      InteractionRequiredError,
    );
  });

  it('re-authenticates one tenant with a login hint', async () => {
    const { provider, client } = setup();
    await provider.acquireTokenInteractive(account.homeAccountId, TENANT, 'scope');
    expect(client.acquireTokenInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: `https://login.microsoftonline.com/${TENANT}`,
        loginHint: account.username,
        scopes: ['scope'],
      }),
    );
  });

  it('times out an abandoned browser sign-in', async () => {
    const { provider, client } = setup();
    client.acquireTokenInteractive.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(provider.signIn({ flow: 'browser' })).rejects.toThrow(/timed out/);
  });

  it('signs out by removing the account from the MSAL cache', async () => {
    const { provider, cache } = setup();
    await provider.signOut(account.homeAccountId);
    expect(cache.removeAccount).toHaveBeenCalledWith(account);
  });
});
