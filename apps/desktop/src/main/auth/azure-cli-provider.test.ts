import { describe, expect, it, vi } from 'vitest';

import { AzureCliAuthProvider, type CommandRunner } from './azure-cli-provider';
import { PUBLIC_CLOUD } from './cloud';
import { InteractionRequiredError, NoAccessError } from './provider';

const T1 = '00000000-0000-0000-0000-0000000000a1';

function cli(run: CommandRunner) {
  return new AzureCliAuthProvider(PUBLIC_CLOUD, vi.fn(run), () => 0);
}

describe('AzureCliAuthProvider', () => {
  it('lists users from `az account list`, one account per user', async () => {
    const provider = cli(() =>
      Promise.resolve(
        JSON.stringify([
          {
            tenantId: T1,
            homeTenantId: T1,
            user: { name: 'Analyst@contoso.example', type: 'user' },
          },
          {
            tenantId: '00000000-0000-0000-0000-0000000000b2',
            homeTenantId: T1,
            user: { name: 'analyst@contoso.example', type: 'user' },
          },
          { tenantId: T1, user: { name: 'sp-id', type: 'servicePrincipal' } },
        ]),
      ),
    );
    expect(await provider.listAccounts()).toEqual([
      {
        id: 'azcli:analyst@contoso.example',
        username: 'Analyst@contoso.example',
        homeTenantId: T1,
        provider: 'azureCli',
      },
    ]);
  });

  it('has no accounts when Azure CLI is missing', async () => {
    expect(await cli(() => Promise.reject(new Error('ENOENT'))).listAccounts()).toEqual([]);
  });

  it('gets tokens per tenant and resource without a shell-built command line', async () => {
    const run = vi.fn<CommandRunner>(() =>
      Promise.resolve(JSON.stringify({ accessToken: 'abc', expires_on: 1_800_000_000 })),
    );
    const provider = new AzureCliAuthProvider(PUBLIC_CLOUD, run);
    const token = await provider.acquireTokenSilent(
      'azcli:x',
      T1,
      'https://api.loganalytics.io/Data.Read',
    );
    expect(token).toEqual({ token: 'abc', expiresOn: new Date(1_800_000_000_000) });
    expect(run).toHaveBeenCalledWith('az', [
      'account',
      'get-access-token',
      '--tenant',
      T1,
      '--resource',
      'https://api.loganalytics.io',
      '--output',
      'json',
    ]);
  });

  it('supports the older expiresOn field', async () => {
    const provider = cli(() =>
      Promise.resolve(
        JSON.stringify({ accessToken: 'abc', expiresOn: '2030-01-01 10:00:00.000000' }),
      ),
    );
    const token = await provider.acquireTokenSilent(
      'azcli:x',
      T1,
      'https://management.azure.com/user_impersonation',
    );
    expect(token.expiresOn.getFullYear()).toBe(2030);
  });

  it('refuses tenant IDs that are not GUIDs (they end up on a command line)', async () => {
    const run = vi.fn<CommandRunner>();
    await expect(
      new AzureCliAuthProvider(PUBLIC_CLOUD, run).acquireTokenSilent('a', 'x & calc', 's'),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('maps CLI errors to interaction-required and no-access', async () => {
    const failing =
      (stderr: string): CommandRunner =>
      () =>
        Promise.reject(Object.assign(new Error('exit 1'), { stderr }));
    await expect(
      cli(failing('AADSTS50076: MFA required. Run az login')).acquireTokenSilent('a', T1, 's'),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    await expect(
      cli(failing('AADSTS50020: User account does not exist in tenant')).acquireTokenSilent(
        'a',
        T1,
        's',
      ),
    ).rejects.toBeInstanceOf(NoAccessError);
  });
});

describe('AzureCliAuthProvider sign-in for a tenant', () => {
  it('runs `az login --tenant` without the subscription prompt, then gets a token', async () => {
    const run = vi.fn<CommandRunner>((_command, args) =>
      Promise.resolve(
        args[0] === 'login'
          ? ''
          : JSON.stringify({ accessToken: 'fresh', expires_on: 1_800_000_000 }),
      ),
    );
    const provider = new AzureCliAuthProvider(PUBLIC_CLOUD, run);
    const token = await provider.acquireTokenInteractive(
      'azcli:x',
      T1,
      'https://management.azure.com/user_impersonation',
    );
    expect(token.token).toBe('fresh');
    expect(run).toHaveBeenNthCalledWith(1, 'az', ['login', '--tenant', T1, '--output', 'none'], {
      timeoutMs: 300_000,
      env: { AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off' },
    });
    expect(run.mock.calls[1]?.[1]).toEqual([
      'account',
      'get-access-token',
      '--tenant',
      T1,
      '--resource',
      'https://management.azure.com/',
      '--output',
      'json',
    ]);
  });

  it('explains why sign-in failed', async () => {
    const failing = (error: object) =>
      new AzureCliAuthProvider(PUBLIC_CLOUD, () =>
        Promise.reject(Object.assign(new Error('x'), error)),
      );
    await expect(failing({ code: 'ENOENT' }).acquireTokenInteractive('a', T1, 's')).rejects.toThrow(
      'Azure CLI was not found',
    );
    await expect(failing({ killed: true }).acquireTokenInteractive('a', T1, 's')).rejects.toThrow(
      'timed out',
    );
    await expect(
      failing({
        stderr: 'WARNING: A web browser has been opened\nERROR: User canceled authentication',
      }).acquireTokenInteractive('a', T1, 's'),
    ).rejects.toThrow(
      "Azure CLI sign-in didn't complete: WARNING: A web browser has been opened ERROR: User canceled authentication",
    );
    await expect(failing({}).acquireTokenInteractive('a', 'not-a-guid', 's')).rejects.toThrow(
      'Invalid tenant ID',
    );
  });
});
