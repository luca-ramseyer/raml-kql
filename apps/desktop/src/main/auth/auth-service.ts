import type {
  Account,
  AccountsSnapshot,
  AddAccountRequest,
  DeviceCodePrompt,
  TenantInfo,
  TokenPersistence,
} from '../../shared/auth/models';
import { AppError } from '../../shared/errors';
import type { DirectoryTenant } from '../azure/arm-tenants';
import { describeError } from '../logging/redact';

import type { AccountEntry, AccountsConfigStore } from './accounts-config';
import { scopeFor, type AzureResource, type CloudProfile } from './cloud';
import {
  InteractionRequiredError,
  NoAccessError,
  SignInError,
  type AuthProvider,
  type ProviderAccount,
} from './provider';
import { TokenCache, type AccessToken } from './token-cache';

export interface AuthProviders {
  /** Built-in MSAL client; undefined when no client ID was configured at build time. */
  builtin?: AuthProvider;
  azureCli?: AuthProvider;
  /** Demo mode: the only provider. */
  demo?: AuthProvider;
  /** MSAL client for a user-supplied client ID (created on demand). */
  custom?: (clientId: string) => AuthProvider;
}

export interface AuthServiceOptions {
  cloud: CloudProfile;
  providers: AuthProviders;
  /** Tenants of an account (ARM `/tenants`, or the demo equivalent). */
  listTenants: (account: ProviderAccount, armToken: string) => Promise<DirectoryTenant[]>;
  config: AccountsConfigStore;
  persistence: TokenPersistence;
  onChange: (snapshot: AccountsSnapshot) => void;
  onDeviceCode: (prompt: DeviceCodePrompt) => void;
  tokenCache?: TokenCache;
}

interface AccountRecord {
  provider: AuthProvider;
  account: ProviderAccount;
  tenants: TenantInfo[];
  refreshing: boolean;
  clientId?: string | undefined;
}

export interface TokenRequest {
  accountId: string;
  tenantId: string;
  resource: AzureResource;
  /** Skip every cache (after the API rejected the token with 401). */
  forceRefresh?: boolean;
}

/**
 * Multi-account, multi-tenant authentication (spec 02). Owns every token: `getToken` is for
 * main-process callers only and is never exposed over IPC.
 */
export class AuthService {
  private readonly records = new Map<string, AccountRecord>();
  private entries: AccountEntry[] = [];
  private readonly tokens: TokenCache;
  private readonly customProviders = new Map<string, AuthProvider>();
  private signInInProgress = false;
  private readonly listeners = new Set<(snapshot: AccountsSnapshot) => void>();

  constructor(private readonly options: AuthServiceOptions) {
    this.tokens = options.tokenCache ?? new TokenCache();
  }

  // --- Lifecycle --------------------------------------------------------------------------

  /** Load accounts from the providers and accounts.jsonc, then refresh tenants in the background. */
  async init(): Promise<AccountsSnapshot> {
    this.entries = await this.options.config.read();
    const { providers } = this.options;
    const found: { provider: AuthProvider; account: ProviderAccount; clientId?: string }[] = [];

    if (providers.demo !== undefined) {
      for (const account of await providers.demo.listAccounts()) {
        found.push({ provider: providers.demo, account });
      }
    } else {
      if (providers.builtin !== undefined) {
        for (const account of await providers.builtin.listAccounts()) {
          found.push({ provider: providers.builtin, account });
        }
      }
      for (const clientId of new Set(
        this.entries.flatMap((e) => (e.clientId === undefined ? [] : [e.clientId])),
      )) {
        const provider = this.customProvider(clientId);
        for (const account of await provider.listAccounts()) {
          found.push({ provider, account, clientId });
        }
      }
      // Azure CLI accounts appear only if the user added them (they're managed by `az login`).
      if (providers.azureCli !== undefined && this.entries.some((e) => e.provider === 'azureCli')) {
        const wanted = new Set(
          this.entries.filter((e) => e.provider === 'azureCli').map((e) => e.id),
        );
        for (const account of await providers.azureCli.listAccounts()) {
          if (wanted.has(account.id)) found.push({ provider: providers.azureCli, account });
        }
      }
    }

    for (const { provider, account, clientId } of found) {
      this.records.set(account.id, {
        provider,
        account,
        clientId,
        tenants: [this.homeTenant(account, 'unknown')],
        refreshing: false,
      });
    }
    this.emit();
    for (const record of this.records.values()) void this.refreshTenants(record);
    return this.snapshot();
  }

  // --- Snapshot ---------------------------------------------------------------------------

  snapshot(): AccountsSnapshot {
    const order = new Map(this.entries.map((entry, index) => [entry.id, index]));
    const accounts: Account[] = [...this.records.values()]
      .map(({ account, tenants, refreshing }) => {
        const label = this.entries.find((e) => e.id === account.id)?.label;
        return {
          id: account.id,
          username: account.username,
          ...(label === undefined ? {} : { label }),
          provider: account.provider,
          homeTenantId: account.homeTenantId,
          tenants,
          refreshing,
        };
      })
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    return {
      accounts,
      builtinAvailable:
        this.options.providers.builtin !== undefined || this.options.providers.demo !== undefined,
      persistence: this.options.persistence,
    };
  }

  /** Main-process subscribers (e.g. discovery re-runs when signed-in tenants change). */
  onDidChange(listener: (snapshot: AccountsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    // Main-process listeners first (discovery adds tenant aliases before the UI sees them).
    for (const listener of this.listeners) listener(snapshot);
    this.options.onChange(snapshot);
  }

  // --- Accounts ---------------------------------------------------------------------------

  private customProvider(clientId: string): AuthProvider {
    let provider = this.customProviders.get(clientId);
    if (provider === undefined) {
      const create = this.options.providers.custom;
      if (create === undefined) throw unavailable('Custom client IDs are not supported here.');
      provider = create(clientId);
      this.customProviders.set(clientId, provider);
    }
    return provider;
  }

  private providerFor(request: AddAccountRequest): { provider: AuthProvider; clientId?: string } {
    const { providers, persistence } = this.options;
    if (providers.demo !== undefined) return { provider: providers.demo };
    if (request.method === 'azureCli') {
      if (providers.azureCli === undefined)
        throw unavailable('Azure CLI sign-in is not available.');
      return { provider: providers.azureCli };
    }
    if (persistence === 'unavailable') {
      throw unavailable(
        'No OS keyring is available to store sign-ins securely. Install and unlock a keyring ' +
          '(GNOME Keyring or KWallet, with libsecret), or turn on "Auth: Session Only" to sign in ' +
          'without keeping sign-ins between sessions.',
      );
    }
    if (request.method === 'custom') {
      return { provider: this.customProvider(request.clientId), clientId: request.clientId };
    }
    if (providers.builtin === undefined) {
      throw unavailable(
        'This build has no built-in client ID. Add the account with a custom client ID or Azure CLI instead.',
      );
    }
    return { provider: providers.builtin };
  }

  async addAccount(request: AddAccountRequest): Promise<AccountsSnapshot> {
    if (this.signInInProgress) {
      throw new AppError({
        code: 'AUTH_FAILED',
        message: 'A sign-in is already in progress. Finish or cancel it first.',
        retryable: false,
        source: 'main',
      });
    }
    const { provider, clientId } = this.providerFor(request);
    const flow =
      request.method === 'deviceCode' ||
      (request.method === 'custom' && request.flow === 'deviceCode')
        ? 'deviceCode'
        : 'browser';
    this.signInInProgress = true;
    let account: ProviderAccount;
    try {
      account = await provider.signIn({ flow, onDeviceCode: this.options.onDeviceCode });
    } catch (error) {
      throw toAppError(error, 'Sign-in failed.');
    } finally {
      this.signInInProgress = false;
    }

    const record: AccountRecord = {
      provider,
      account,
      clientId,
      tenants: [this.homeTenant(account, 'unknown')],
      refreshing: false,
    };
    this.records.set(account.id, record);
    await this.upsertEntry(account, clientId);
    this.emit();
    await this.refreshTenants(record);
    return this.snapshot();
  }

  async removeAccount(accountId: string): Promise<AccountsSnapshot> {
    const record = this.record(accountId);
    this.tokens.clearAccount(accountId); // takes effect immediately (spec 02, "Security rules")
    this.records.delete(accountId);
    try {
      await record.provider.signOut(accountId);
    } finally {
      this.entries = this.entries.filter((entry) => entry.id !== accountId);
      await this.options.config.write(this.entries);
      this.emit();
    }
    return this.snapshot();
  }

  async setLabel(accountId: string, label: string | null): Promise<AccountsSnapshot> {
    const record = this.record(accountId);
    await this.upsertEntry(
      record.account,
      record.clientId,
      label === null || label.trim() === '' ? null : label.trim(),
    );
    this.emit();
    return this.snapshot();
  }

  /** Interactive sign-in for one tenant (default: the home tenant), then refresh its tenants. */
  async reauthenticate(accountId: string, tenantId?: string): Promise<AccountsSnapshot> {
    const record = this.record(accountId);
    const tenant = tenantId ?? record.account.homeTenantId;
    try {
      await record.provider.acquireTokenInteractive(
        accountId,
        tenant,
        scopeFor(this.options.cloud, 'arm'),
      );
    } catch (error) {
      throw toAppError(error, 'Sign-in failed.');
    }
    this.tokens.clearAccount(accountId);
    await this.refreshTenants(record);
    return this.snapshot();
  }

  async refresh(accountId?: string): Promise<AccountsSnapshot> {
    const records = accountId === undefined ? [...this.records.values()] : [this.record(accountId)];
    await Promise.all(records.map((record) => this.refreshTenants(record)));
    return this.snapshot();
  }

  // --- Tokens -----------------------------------------------------------------------------

  /**
   * Token routing (spec 02): authority = the tenant, silent only. Interaction-required marks
   * the tenant `needsReauth` and fails with AUTH_INTERACTION_REQUIRED instead of popping a
   * browser in the middle of a fan-out.
   */
  async getToken(request: TokenRequest): Promise<AccessToken> {
    const record = this.record(request.accountId);
    const key = TokenCache.key(request.accountId, request.tenantId, request.resource);
    if (request.forceRefresh === true) this.tokens.invalidate(key);
    try {
      const token = await this.tokens.getOrFetch(key, () =>
        record.provider.acquireTokenSilent(
          request.accountId,
          request.tenantId,
          scopeFor(this.options.cloud, request.resource),
          { forceRefresh: request.forceRefresh === true },
        ),
      );
      this.setTenantState(record, request.tenantId, 'ok');
      return token;
    } catch (error) {
      if (error instanceof InteractionRequiredError) {
        this.setTenantState(record, request.tenantId, 'needsReauth', error.reason);
      } else if (error instanceof NoAccessError) {
        this.setTenantState(record, request.tenantId, 'noAccess', describeError(error.message));
      }
      throw toAppError(error, 'Could not get an access token.');
    }
  }

  /** (account, tenant) pairs that need the user to sign in again. */
  tenantsNeedingReauth(): { accountId: string; tenantId: string }[] {
    return [...this.records.values()].flatMap((record) =>
      record.tenants
        .filter((tenant) => tenant.state === 'needsReauth')
        .map((tenant) => ({ accountId: record.account.id, tenantId: tenant.tenantId })),
    );
  }

  // --- Internals --------------------------------------------------------------------------

  private record(accountId: string): AccountRecord {
    const record = this.records.get(accountId);
    if (record === undefined) {
      throw new AppError({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'That account is no longer signed in.',
        retryable: false,
        source: 'main',
      });
    }
    return record;
  }

  private homeTenant(account: ProviderAccount, state: TenantInfo['state']): TenantInfo {
    return { tenantId: account.homeTenantId, relation: 'home', state };
  }

  private setTenantState(
    record: AccountRecord,
    tenantId: string,
    state: TenantInfo['state'],
    detail?: string,
  ): void {
    const id = tenantId.toLowerCase();
    const tenant = record.tenants.find((t) => t.tenantId === id);
    if (tenant === undefined || (tenant.state === state && tenant.detail === detail)) return;
    record.tenants = record.tenants.map((t) =>
      t.tenantId === id
        ? { ...t, state, ...(detail === undefined ? { detail: undefined } : { detail }) }
        : t,
    );
    this.emit();
  }

  private async upsertEntry(
    account: ProviderAccount,
    clientId: string | undefined,
    label?: string | null,
  ): Promise<void> {
    const existing = this.entries.find((entry) => entry.id === account.id);
    const next: AccountEntry = {
      id: account.id,
      provider: account.provider,
      username: account.username,
      ...(clientId === undefined ? {} : { clientId }),
      ...(label === undefined
        ? existing?.label === undefined
          ? {}
          : { label: existing.label }
        : label === null
          ? {}
          : { label }),
    };
    this.entries =
      existing === undefined
        ? [...this.entries, next]
        : this.entries.map((entry) => (entry.id === account.id ? next : entry));
    await this.options.config.write(this.entries);
  }

  private async refreshTenants(record: AccountRecord): Promise<void> {
    record.refreshing = true;
    this.emit();
    try {
      const { account } = record;
      let armToken: AccessToken;
      try {
        armToken = await this.getToken({
          accountId: account.id,
          tenantId: account.homeTenantId,
          resource: 'arm',
        });
      } catch {
        return; // home tenant state was updated by getToken
      }

      let directory: DirectoryTenant[];
      try {
        directory = await this.options.listTenants(account, armToken.token);
      } catch (error) {
        directory = [];
        record.tenants = [
          {
            ...this.homeTenant(account, 'ok'),
            detail: `Could not list tenants: ${describeError(error)}`,
          },
        ];
      }
      const known = new Map(record.tenants.map((t) => [t.tenantId, t]));
      const tenants: TenantInfo[] = directory.map((tenant) => ({
        tenantId: tenant.tenantId,
        relation: tenant.relation,
        state: known.get(tenant.tenantId)?.state ?? 'unknown',
        ...(tenant.displayName === undefined ? {} : { displayName: tenant.displayName }),
        ...(tenant.defaultDomain === undefined ? {} : { defaultDomain: tenant.defaultDomain }),
      }));
      if (!tenants.some((t) => t.tenantId === account.homeTenantId)) {
        tenants.unshift(this.homeTenant(account, 'ok'));
      }
      record.tenants = tenants.sort((a, b) =>
        a.relation === 'home' ? -1 : b.relation === 'home' ? 1 : 0,
      );
      this.emit();

      // Probe every other tenant with a silent ARM token.
      await Promise.all(
        record.tenants
          .filter((tenant) => tenant.tenantId !== account.homeTenantId)
          .map(async (tenant) => {
            try {
              await this.getToken({
                accountId: account.id,
                tenantId: tenant.tenantId,
                resource: 'arm',
              });
            } catch (error) {
              if (
                !(error instanceof AppError) ||
                !['AUTH_INTERACTION_REQUIRED', 'AUTH_NO_ACCESS'].includes(error.code)
              ) {
                this.setTenantState(record, tenant.tenantId, 'unknown', describeError(error));
              }
            }
          }),
      );
    } finally {
      record.refreshing = false;
      this.emit();
    }
  }
}

function unavailable(message: string): AppError {
  return new AppError({ code: 'AUTH_UNAVAILABLE', message, retryable: false, source: 'main' });
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InteractionRequiredError) {
    return new AppError({
      code: 'AUTH_INTERACTION_REQUIRED',
      message: 'This tenant needs you to sign in again.',
      detail: error.reason,
      retryable: false,
      source: 'main',
    });
  }
  if (error instanceof NoAccessError) {
    return new AppError({
      code: 'AUTH_NO_ACCESS',
      message: describeError(error.message).replace(/^Error: /, ''),
      retryable: false,
      source: 'main',
    });
  }
  if (error instanceof SignInError) {
    return new AppError({
      code: 'AUTH_FAILED',
      message: describeError(error.message).replace(/^Error: /, ''),
      retryable: true,
      source: 'main',
    });
  }
  const detail = describeError(error);
  if (/timed out|cancel|user_cancelled|closed/i.test(detail)) {
    return new AppError({
      code: 'AUTH_CANCELLED',
      message: 'Sign-in was cancelled or timed out.',
      detail,
      retryable: true,
      source: 'main',
    });
  }
  return new AppError({
    code: 'AUTH_FAILED',
    message: fallback,
    detail,
    retryable: true,
    source: 'main',
  });
}
