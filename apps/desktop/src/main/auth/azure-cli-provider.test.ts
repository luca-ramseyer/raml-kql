import { execFile } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AzureCliAuthProvider, execAzureCli, type CommandRunner } from './azure-cli-provider';
import { PUBLIC_CLOUD } from './cloud';
import { InteractionRequiredError, NoAccessError } from './provider';

const T1 = '00000000-0000-0000-0000-0000000000a1';
const S1 = '00000000-0000-0000-0000-000000000001';
const PROFILE = { id: S1, tenantId: T1, user: { name: 'x', type: 'user' } };

function tokenRunner(token: object): CommandRunner {
  return (_command, args) =>
    Promise.resolve(JSON.stringify(args[1] === 'list' ? [PROFILE] : token));
}

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, 'ok', '');
    },
  ),
}));

describe('Azure CLI process launcher', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const environment = process.env;

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    process.env = environment;
    vi.clearAllMocks();
  });

  it('preserves Windows Path and adds both standard MSI install folders', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env = {
      Path: 'C:\\Windows\\System32;C:\\tools',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    };
    await execAzureCli('az', ['account', 'list']);
    expect(execFile).toHaveBeenLastCalledWith(
      'az',
      ['account', 'list'],
      expect.objectContaining({
        shell: true,
        windowsHide: true,
        env: expect.objectContaining({
          PATH: [
            'C:\\Windows\\System32',
            'C:\\tools',
            'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin',
            'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin',
          ].join(';'),
        }) as unknown,
      }),
      expect.any(Function),
    );
    const options = vi.mocked(execFile).mock.calls.at(-1)?.[2];
    expect(options).toHaveProperty('env.PATH');
    expect(options).not.toHaveProperty('env.Path');
  });

  it('merges Windows environment overrides case-insensitively', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env = { Path: 'C:\\old', azure_core_login_experience_v2: 'on' };
    await execAzureCli('az', ['login'], {
      env: { PATH: 'C:\\new', AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off' },
    });
    expect(execFile).toHaveBeenLastCalledWith(
      'az',
      ['login'],
      expect.objectContaining({
        env: { PATH: 'C:\\new', AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off' },
      }),
      expect.any(Function),
    );
  });

  it('preserves macOS PATH entries without adding duplicate install folders', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env = { PATH: '/usr/bin:/opt/homebrew/bin' };
    await execAzureCli('az', ['account', 'list']);
    expect(execFile).toHaveBeenLastCalledWith(
      'az',
      ['account', 'list'],
      expect.objectContaining({
        shell: false,
        env: { PATH: '/usr/bin:/opt/homebrew/bin:/usr/local/bin' },
      }),
      expect.any(Function),
    );
  });
});

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

  it('does not crash startup on malformed account output', async () => {
    await expect(cli(() => Promise.resolve('not JSON')).listAccounts()).resolves.toEqual([]);
  });

  it('shows the instructions when adding a CLI account without an existing login', async () => {
    await expect(cli(() => Promise.resolve('[]')).signIn()).rejects.toMatchObject({
      name: 'SignInError',
      message: expect.stringContaining('run "az login" in a terminal') as unknown,
    });
  });

  it('adds the selected CLI identity instead of the first cached subscription', async () => {
    const provider = cli(() =>
      Promise.resolve(
        JSON.stringify([
          { ...PROFILE, user: { name: 'old@example.com', type: 'user' } },
          { ...PROFILE, isDefault: true, user: { name: 'selected@example.com', type: 'user' } },
        ]),
      ),
    );
    expect((await provider.signIn()).id).toBe('azcli:selected@example.com');
  });

  it('gets tokens per tenant and resource without a shell-built command line', async () => {
    const run = vi.fn(tokenRunner({ accessToken: 'abc', expires_on: 1_800_000_000 }));
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
      '--subscription',
      S1,
      '--resource',
      'https://api.loganalytics.io',
      '--output',
      'json',
    ]);
  });

  it('supports the older expiresOn field', async () => {
    const provider = cli(
      tokenRunner({ accessToken: 'abc', expiresOn: '2030-01-01 10:00:00.000000' }),
    );
    const token = await provider.acquireTokenSilent(
      'azcli:x',
      T1,
      'https://management.azure.com/user_impersonation',
    );
    expect(token.expiresOn.getFullYear()).toBe(2030);
  });

  it('selects the requested account and tenant even when another user is the CLI default', async () => {
    const token = { accessToken: 'requested-user', expires_on: 1_800_000_000 };
    const run = vi.fn<CommandRunner>((_command, args) =>
      Promise.resolve(
        JSON.stringify(
          args[1] === 'list'
            ? [
                { ...PROFILE, isDefault: true, user: { name: 'other', type: 'user' } },
                {
                  ...PROFILE,
                  id: '00000000-0000-0000-0000-000000000002',
                  tenantId: '00000000-0000-0000-0000-0000000000b2',
                },
                { ...PROFILE, user: { name: 'X', type: 'user' } },
              ]
            : token,
        ),
      ),
    );
    const provider = new AzureCliAuthProvider(PUBLIC_CLOUD, run);
    expect((await provider.acquireTokenSilent('azcli:x', T1.toUpperCase(), 's')).token).toBe(
      'requested-user',
    );
    expect(run).toHaveBeenLastCalledWith('az', [
      'account',
      'get-access-token',
      '--subscription',
      S1,
      '--resource',
      'https://management.azure.com/',
      '--output',
      'json',
    ]);
    expect(run).not.toHaveBeenCalledWith('az', expect.arrayContaining(['set']));
  });

  it.each([
    [],
    [{ ...PROFILE, user: { name: 'other', type: 'user' } }],
    [{ ...PROFILE, tenantId: '00000000-0000-0000-0000-0000000000b2' }],
    [{ ...PROFILE, id: 'x & calc' }],
    [{ ...PROFILE, user: { name: 'x', type: 'servicePrincipal' } }],
  ])('requires sign-in instead of falling back to another identity (%j)', async (...profiles) => {
    const run = vi.fn<CommandRunner>(() => Promise.resolve(JSON.stringify(profiles)));
    await expect(
      new AzureCliAuthProvider(PUBLIC_CLOUD, run).acquireTokenSilent('azcli:x', T1, 's'),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toContain('list');
  });

  it('supports tenant-level CLI profiles without a subscription', async () => {
    const run = vi.fn<CommandRunner>((_command, args) =>
      Promise.resolve(
        JSON.stringify(
          args[1] === 'list'
            ? [{ ...PROFILE, id: T1 }]
            : { accessToken: 'abc', expires_on: 1_800_000_000 },
        ),
      ),
    );
    await new AzureCliAuthProvider(PUBLIC_CLOUD, run).acquireTokenSilent('azcli:x', T1, 's');
    expect(run).toHaveBeenLastCalledWith('az', expect.arrayContaining(['--subscription', T1]));
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
      (_command, args) =>
        args[1] === 'list'
          ? Promise.resolve(JSON.stringify([PROFILE]))
          : Promise.reject(Object.assign(new Error('exit 1'), { stderr }));
    await expect(
      cli(failing('AADSTS50076: MFA required. Run az login')).acquireTokenSilent(
        'azcli:x',
        T1,
        's',
      ),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    await expect(
      cli(failing('AADSTS50020: User account does not exist in tenant')).acquireTokenSilent(
        'azcli:x',
        T1,
        's',
      ),
    ).rejects.toBeInstanceOf(NoAccessError);
    await expect(
      cli(failing('AADSTS50020: User account does not exist. Run az login.')).acquireTokenSilent(
        'azcli:x',
        T1,
        's',
      ),
    ).rejects.toBeInstanceOf(NoAccessError);
    await expect(
      cli(failing('ERROR: Unexpected CLI failure')).acquireTokenSilent('azcli:x', T1, 's'),
    ).rejects.toThrow('Unexpected CLI failure');
  });

  it('preserves process-launch errors when stderr is empty', async () => {
    await expect(
      cli(() => Promise.reject(new Error('spawn EACCES'))).acquireTokenSilent('azcli:x', T1, 's'),
    ).rejects.toThrow('Azure CLI failed: spawn EACCES');
  });
});

describe('AzureCliAuthProvider sign-in for a tenant', () => {
  it('does not acquire a token for a different user selected during sign-in', async () => {
    const run = vi.fn<CommandRunner>((_command, args) =>
      Promise.resolve(
        args[0] === 'login'
          ? ''
          : JSON.stringify([{ ...PROFILE, user: { name: 'other', type: 'user' } }]),
      ),
    );
    await expect(
      new AzureCliAuthProvider(PUBLIC_CLOUD, run).acquireTokenInteractive('azcli:x', T1, 's'),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[1]).toContain('list');
  });

  it('runs `az login --tenant` without the subscription prompt, then gets a token', async () => {
    const run = vi.fn<CommandRunner>((_command, args) =>
      Promise.resolve(
        args[0] === 'login'
          ? ''
          : JSON.stringify(
              args[1] === 'list' ? [PROFILE] : { accessToken: 'fresh', expires_on: 1_800_000_000 },
            ),
      ),
    );
    const provider = new AzureCliAuthProvider(PUBLIC_CLOUD, run);
    const token = await provider.acquireTokenInteractive(
      'azcli:x',
      T1,
      'https://management.azure.com/user_impersonation',
    );
    expect(token.token).toBe('fresh');
    expect(run).toHaveBeenNthCalledWith(
      1,
      'az',
      ['login', '--tenant', T1, '--allow-no-subscriptions', '--output', 'none'],
      {
        timeoutMs: 300_000,
        env: {
          AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off',
          AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: 'false',
        },
      },
    );
    expect(run.mock.calls[2]?.[1]).toEqual([
      'account',
      'get-access-token',
      '--subscription',
      S1,
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
    await expect(
      failing({
        code: 1,
        stderr: "'az' is not recognized as an internal or external command,",
      }).acquireTokenInteractive('a', T1, 's'),
    ).rejects.toThrow('Azure CLI was not found');
    await expect(
      failing({ message: 'spawn EACCES' }).acquireTokenInteractive('a', T1, 's'),
    ).rejects.toThrow('spawn EACCES');
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
