import type { AuthProviderKind, DeviceCodePrompt } from '../../shared/auth/models';

import type { AccessToken } from './token-cache';

/** An account as a provider knows it. */
export interface ProviderAccount {
  /** Stable id across restarts. */
  id: string;
  username: string;
  homeTenantId: string;
  provider: AuthProviderKind;
}

/** Thrown when a token can't be acquired without the user (MFA, CA, consent). */
export class InteractionRequiredError extends Error {
  constructor(
    message: string,
    /** Short reason safe to show, e.g. "MFA required" or an AADSTS code. */
    readonly reason: string,
  ) {
    super(message);
    this.name = 'InteractionRequiredError';
  }
}

/** Thrown when the account has no access to the requested tenant/resource at all. */
export class NoAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAccessError';
  }
}

export interface SignInOptions {
  flow: 'browser' | 'deviceCode';
  /** Device code flow: show the code to the user. */
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
}

/**
 * One way of signing in (spec 02, "Auth provider modes"). Implementations: MSAL (builtin and
 * custom client IDs), Azure CLI and demo.
 */
export interface AuthProvider {
  readonly kind: AuthProviderKind;
  /** Accounts this provider can currently use (e.g. from the MSAL cache or `az account list`). */
  listAccounts(): Promise<ProviderAccount[]>;
  /** Add an account. Returns the account that signed in. */
  signIn(options: SignInOptions): Promise<ProviderAccount>;
  signOut(accountId: string): Promise<void>;
  /** Throws {@link InteractionRequiredError} or {@link NoAccessError} when appropriate. */
  acquireTokenSilent(accountId: string, tenantId: string, scope: string): Promise<AccessToken>;
  /** Interactive re-authentication for one tenant (system browser). */
  acquireTokenInteractive(accountId: string, tenantId: string, scope: string): Promise<AccessToken>;
}
