import {
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
  type ICachePlugin,
} from '@azure/msal-node';

import { authorityFor, scopeFor, type CloudProfile } from './cloud';
import {
  InteractionRequiredError,
  NoAccessError,
  type AuthProvider,
  type ProviderAccount,
  type SignInOptions,
} from './provider';
import type { AccessToken } from './token-cache';

/** Entra error codes meaning "this user has no business in that tenant". */
const NO_ACCESS_CODES = ['AADSTS50020', 'AADSTS90072', 'AADSTS700016', 'AADSTS50177'];
/** Admin consent needed: the user can't fix this by signing in again. */
const ADMIN_CONSENT_CODES = ['AADSTS90094', 'AADSTS90099'];

function aadstsCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  // MSAL 7 puts the numeric Entra code in `errorNo` and replaces the server message with a
  // docs link; older paths still carry "AADSTSnnnnn" in the message.
  const errorNo = (error as { errorNo?: unknown }).errorNo;
  if (typeof errorNo === 'string' && /^\d{5,6}$/.test(errorNo)) return `AADSTS${errorNo}`;
  const extra = (error as { errorMessage?: unknown }).errorMessage;
  const text = `${error.message} ${typeof extra === 'string' ? extra : ''}`;
  return /AADSTS\d{5,6}/.exec(text)?.[0];
}

/**
 * Translate an MSAL failure into our provider errors. Messages keep only the error code,
 * never tokens or full server responses.
 */
export function mapMsalError(error: unknown, clientId: string, tenantId: string): Error {
  const code = aadstsCode(error);
  if (code !== undefined && ADMIN_CONSENT_CODES.includes(code)) {
    return new NoAccessError(
      `${code}: an administrator of tenant ${tenantId} must consent to Raml KQL first. ` +
        `Admin consent URL: https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${clientId}`,
    );
  }
  if (code !== undefined && NO_ACCESS_CODES.includes(code)) {
    return new NoAccessError(`${code}: this account has no access to tenant ${tenantId}.`);
  }
  if (error instanceof InteractionRequiredAuthError) {
    const reason = code ?? (error.subError !== '' ? error.subError : error.errorCode);
    return new InteractionRequiredError(`Interaction required (${reason})`, reason);
  }
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return new Error(
    code === undefined ? `Sign-in failed: ${message ?? ''}` : `Sign-in failed: ${code}`,
  );
}

export interface MsalProviderOptions {
  kind: 'builtin' | 'custom';
  clientId: string;
  cloud: CloudProfile;
  /** Omit for session-only (in-memory) sign-in. */
  cachePlugin?: ICachePlugin;
  /** Opens the system browser. Must never be an embedded webview (spec 02). */
  openBrowser: (url: string) => Promise<void>;
  /** Abandoned interactive sign-ins are rejected after this long. */
  interactiveTimeoutMs?: number;
  /** Test seam: build the MSAL client (defaults to `new PublicClientApplication`). */
  createClient?: (configuration: Configuration) => MsalClient;
}

/** The part of MSAL's PublicClientApplication this provider uses. */
export type MsalClient = Pick<
  PublicClientApplication,
  'getTokenCache' | 'acquireTokenSilent' | 'acquireTokenInteractive' | 'acquireTokenByDeviceCode'
>;

const SIGN_IN_SCOPES = ['openid', 'profile', 'offline_access'];

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;margin:15vh auto;max-width:32em;text-align:center">` +
  `<h1 style="font-weight:400">${title}</h1><p>${text}</p></body>`;

/**
 * MSAL public client (spec 02): system-browser sign-in with a loopback redirect, device code
 * fallback, silent per-tenant tokens with the tenant as authority, and CAE-ready client
 * capabilities. One instance per client ID (the built-in one, or a user's custom one).
 */
export class MsalAuthProvider implements AuthProvider {
  readonly kind: 'builtin' | 'custom';
  private readonly app: MsalClient;

  constructor(private readonly options: MsalProviderOptions) {
    this.kind = options.kind;
    const configuration: Configuration = {
      auth: {
        clientId: options.clientId,
        authority: authorityFor(options.cloud, 'organizations'),
        clientCapabilities: ['cp1'],
      },
      ...(options.cachePlugin === undefined ? {} : { cache: { cachePlugin: options.cachePlugin } }),
      system: {
        loggerOptions: {
          // MSAL logs can contain PII and tokens; keep them off.
          piiLoggingEnabled: false,
          logLevel: LogLevel.Error,
          loggerCallback: () => undefined,
        },
      },
    };
    this.app = options.createClient?.(configuration) ?? new PublicClientApplication(configuration);
  }

  get clientId(): string {
    return this.options.clientId;
  }

  private toProviderAccount(account: AccountInfo): ProviderAccount {
    return {
      id: account.homeAccountId,
      username: account.username,
      // homeAccountId is "<objectId>.<homeTenantId>"
      homeTenantId: (account.homeAccountId.split('.')[1] ?? account.tenantId).toLowerCase(),
      provider: this.kind,
    };
  }

  private async account(accountId: string): Promise<AccountInfo> {
    const account = await this.app.getTokenCache().getAccountByHomeId(accountId);
    if (account === null) throw new InteractionRequiredError('Account not in cache', 'signed out');
    return account;
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    const accounts = await this.app.getTokenCache().getAllAccounts();
    return accounts.map((account) => this.toProviderAccount(account));
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    const ms = this.options.interactiveTimeoutMs ?? 5 * 60 * 1000;
    return Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Sign-in timed out. Try again, or use device code sign-in.'));
        }, ms).unref();
      }),
    ]);
  }

  async signIn(options: SignInOptions): Promise<ProviderAccount> {
    const scopes = [scopeFor(this.options.cloud, 'arm'), ...SIGN_IN_SCOPES];
    let result: AuthenticationResult | null;
    try {
      result =
        options.flow === 'deviceCode'
          ? await this.app.acquireTokenByDeviceCode({
              scopes,
              deviceCodeCallback: (response) => {
                options.onDeviceCode?.({
                  userCode: response.userCode,
                  verificationUri: response.verificationUri,
                  message: response.message,
                  expiresInSeconds: response.expiresIn,
                });
              },
            })
          : await this.withTimeout(
              this.app.acquireTokenInteractive({
                scopes,
                prompt: 'select_account',
                openBrowser: this.options.openBrowser,
                successTemplate: PAGE(
                  'Signed in',
                  'You can close this tab and return to Raml KQL.',
                ),
                errorTemplate: PAGE('Sign-in failed', 'Return to Raml KQL for details.'),
              }),
            );
    } catch (error) {
      throw mapMsalError(error, this.options.clientId, 'organizations');
    }
    if (result?.account === null || result?.account === undefined) {
      throw new Error('Sign-in did not return an account.');
    }
    return this.toProviderAccount(result.account);
  }

  async signOut(accountId: string): Promise<void> {
    const account = await this.app.getTokenCache().getAccountByHomeId(accountId);
    if (account !== null) await this.app.getTokenCache().removeAccount(account);
  }

  private toAccessToken(result: AuthenticationResult | null): AccessToken {
    if (result === null || result.accessToken === '' || result.expiresOn === null) {
      throw new Error('No token returned.');
    }
    return { token: result.accessToken, expiresOn: result.expiresOn };
  }

  async acquireTokenSilent(
    accountId: string,
    tenantId: string,
    scope: string,
  ): Promise<AccessToken> {
    const account = await this.account(accountId);
    try {
      return this.toAccessToken(
        await this.app.acquireTokenSilent({
          account,
          scopes: [scope],
          authority: authorityFor(this.options.cloud, tenantId),
        }),
      );
    } catch (error) {
      throw mapMsalError(error, this.options.clientId, tenantId);
    }
  }

  async acquireTokenInteractive(
    accountId: string,
    tenantId: string,
    scope: string,
  ): Promise<AccessToken> {
    const account = await this.app.getTokenCache().getAccountByHomeId(accountId);
    try {
      return this.toAccessToken(
        await this.withTimeout(
          this.app.acquireTokenInteractive({
            scopes: [scope],
            authority: authorityFor(this.options.cloud, tenantId),
            ...(account === null ? {} : { loginHint: account.username }),
            openBrowser: this.options.openBrowser,
            successTemplate: PAGE('Signed in', 'You can close this tab and return to Raml KQL.'),
            errorTemplate: PAGE('Sign-in failed', 'Return to Raml KQL for details.'),
          }),
        ),
      );
    } catch (error) {
      throw mapMsalError(error, this.options.clientId, tenantId);
    }
  }
}
