import { execFile } from 'node:child_process';

import { z } from 'zod';

import type { CloudProfile } from './cloud';
import { resourceUriFor } from './cloud';
import {
  InteractionRequiredError,
  NoAccessError,
  type AuthProvider,
  type ProviderAccount,
} from './provider';
import type { AccessToken } from './token-cache';

/** Runs the Azure CLI and returns stdout. Injected so tests never spawn processes. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>;

export const execAzureCli: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    // execFile passes arguments directly, without a shell, except on Windows: there `az` is a
    // .cmd script, which Node only runs through the shell. That is safe here because every
    // argument is a fixed string, a validated GUID or an endpoint URL from the cloud profile.
    execFile(
      command,
      [...args],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' },
      (error, stdout, stderr) => {
        if (error !== null) {
          const failure: Error & { stderr?: string } = error;
          failure.stderr = stderr;
          reject(failure);
          return;
        }
        resolve(stdout);
      },
    );
  });

const AccountListSchema = z.array(
  z.object({
    tenantId: z.string(),
    homeTenantId: z.string().optional(),
    user: z.object({ name: z.string(), type: z.string() }).optional(),
  }),
);

const TokenSchema = z.object({
  accessToken: z.string().min(1),
  /** Unix seconds (Azure CLI 2.54+). */
  expires_on: z.union([z.number(), z.string()]).optional(),
  /** Local time string (older Azure CLI). */
  expiresOn: z.string().optional(),
});

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tokens via `az account get-access-token` (spec 02, mode `azureCli`), for environments where
 * app consent is impossible. Requires Azure CLI and `az login`. Accounts mirror `az account list`.
 */
export class AzureCliAuthProvider implements AuthProvider {
  readonly kind = 'azureCli' as const;

  constructor(
    private readonly cloud: CloudProfile,
    private readonly run: CommandRunner = execAzureCli,
    private readonly now: () => number = Date.now,
  ) {}

  static accountId(username: string): string {
    return `azcli:${username.toLowerCase()}`;
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    let output: string;
    try {
      output = await this.run('az', ['account', 'list', '--all', '--output', 'json']);
    } catch {
      return []; // Azure CLI not installed or not logged in: no accounts from this provider.
    }
    const parsed = AccountListSchema.safeParse(JSON.parse(output));
    if (!parsed.success) return [];
    const accounts = new Map<string, ProviderAccount>();
    for (const entry of parsed.data) {
      if (entry.user?.type !== 'user' || !GUID.test(entry.homeTenantId ?? entry.tenantId)) continue;
      const id = AzureCliAuthProvider.accountId(entry.user.name);
      if (!accounts.has(id)) {
        accounts.set(id, {
          id,
          username: entry.user.name,
          homeTenantId: (entry.homeTenantId ?? entry.tenantId).toLowerCase(),
          provider: 'azureCli',
        });
      }
    }
    return [...accounts.values()];
  }

  async signIn(): Promise<ProviderAccount> {
    const accounts = await this.listAccounts();
    const [first] = accounts;
    if (first === undefined) {
      throw new Error(
        'No Azure CLI login found. Install Azure CLI, run "az login" in a terminal, then try again.',
      );
    }
    return first;
  }

  /** Azure CLI sessions are managed with `az login` / `az logout`; nothing to do here. */
  signOut(): Promise<void> {
    return Promise.resolve();
  }

  async acquireTokenSilent(
    _accountId: string,
    tenantId: string,
    scope: string,
  ): Promise<AccessToken> {
    if (!GUID.test(tenantId)) throw new Error('Invalid tenant ID');
    const resource = scope.startsWith(this.cloud.logAnalyticsEndpoint)
      ? resourceUriFor(this.cloud, 'logAnalytics')
      : resourceUriFor(this.cloud, 'arm');
    let output: string;
    try {
      output = await this.run('az', [
        'account',
        'get-access-token',
        '--tenant',
        tenantId,
        '--resource',
        resource,
        '--output',
        'json',
      ]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      if (/AADSTS50076|AADSTS50079|AADSTS50158|interaction|az login/i.test(stderr)) {
        throw new InteractionRequiredError(stderr.slice(0, 300), 'run "az login" for this tenant');
      }
      if (/AADSTS50020|AADSTS700016|AADSTS90072|not found|no subscriptions/i.test(stderr)) {
        throw new NoAccessError(stderr.slice(0, 300));
      }
      throw new Error(`Azure CLI failed: ${stderr.slice(0, 300)}`);
    }
    const token = TokenSchema.parse(JSON.parse(output));
    const expiresOn =
      token.expires_on !== undefined
        ? new Date(Number(token.expires_on) * 1000)
        : token.expiresOn !== undefined
          ? new Date(token.expiresOn)
          : new Date(this.now() + 30 * 60 * 1000);
    return { token: token.accessToken, expiresOn };
  }

  acquireTokenInteractive(): Promise<AccessToken> {
    return Promise.reject(
      new Error('Azure CLI accounts sign in with "az login --tenant <tenant>" in a terminal.'),
    );
  }
}
