import type { TenantRelation } from '../../shared/auth/models';

import {
  InteractionRequiredError,
  type AuthProvider,
  type ProviderAccount,
  type SignInOptions,
} from './provider';
import type { AccessToken } from './token-cache';

/**
 * Demo mode auth (spec 04, "Demo mode"): fake accounts and tenants, no network. Two accounts
 * and three tenants from `/tenants`; Lighthouse customer tenants arrive with discovery
 * (Phase 3). One guest tenant needs re-authentication until the user signs in to it.
 */
export interface DemoTenant {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
  relation: TenantRelation;
}

export const DEMO_TENANTS = {
  contoso: {
    tenantId: '00000000-0000-0000-0000-00000000c001',
    displayName: 'Contoso',
    defaultDomain: 'contoso.example',
  },
  northwind: {
    tenantId: '00000000-0000-0000-0000-00000000c002',
    displayName: 'Northwind Traders',
    defaultDomain: 'northwind.example',
  },
  woodgrove: {
    tenantId: '00000000-0000-0000-0000-00000000c003',
    displayName: 'Woodgrove Bank',
    defaultDomain: 'woodgrove.example',
  },
} as const;

interface DemoAccount extends ProviderAccount {
  tenants: DemoTenant[];
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 'demo:analyst@contoso.example',
    username: 'analyst@contoso.example',
    homeTenantId: DEMO_TENANTS.contoso.tenantId,
    provider: 'demo',
    tenants: [
      { ...DEMO_TENANTS.contoso, relation: 'home' },
      { ...DEMO_TENANTS.northwind, relation: 'guest' },
    ],
  },
  {
    id: 'demo:guest@woodgrove.example',
    username: 'guest@woodgrove.example',
    homeTenantId: DEMO_TENANTS.woodgrove.tenantId,
    provider: 'demo',
    tenants: [{ ...DEMO_TENANTS.woodgrove, relation: 'home' }],
  },
];

export class DemoAuthProvider implements AuthProvider {
  readonly kind = 'demo' as const;
  private readonly signedIn = new Set(DEMO_ACCOUNTS.map((account) => account.id));
  /** (account, tenant) pairs that need interactive sign-in until reauthenticated. */
  private readonly needsReauth = new Set([
    `demo:analyst@contoso.example|${DEMO_TENANTS.northwind.tenantId}`,
  ]);

  constructor(private readonly now: () => number = Date.now) {}

  listAccounts(): Promise<ProviderAccount[]> {
    return Promise.resolve(
      DEMO_ACCOUNTS.filter((account) => this.signedIn.has(account.id)).map(
        ({ tenants: _tenants, ...account }) => account,
      ),
    );
  }

  /** The demo equivalent of ARM `/tenants`. */
  tenantsFor(accountId: string): DemoTenant[] {
    return DEMO_ACCOUNTS.find((account) => account.id === accountId)?.tenants ?? [];
  }

  signIn(options: SignInOptions): Promise<ProviderAccount> {
    const next = DEMO_ACCOUNTS.find((account) => !this.signedIn.has(account.id));
    if (next === undefined) {
      return Promise.reject(new Error('All demo accounts are already signed in.'));
    }
    if (options.flow === 'deviceCode') {
      options.onDeviceCode?.({
        userCode: 'DEMO-CODE',
        verificationUri: 'https://microsoft.com/devicelogin',
        message: 'Demo mode: no real sign-in happens.',
        expiresInSeconds: 900,
      });
    }
    this.signedIn.add(next.id);
    const { tenants: _tenants, ...account } = next;
    return Promise.resolve(account);
  }

  signOut(accountId: string): Promise<void> {
    this.signedIn.delete(accountId);
    return Promise.resolve();
  }

  private token(): AccessToken {
    return { token: 'demo-token', expiresOn: new Date(this.now() + 60 * 60 * 1000) };
  }

  acquireTokenSilent(accountId: string, tenantId: string): Promise<AccessToken> {
    if (!this.signedIn.has(accountId)) {
      return Promise.reject(new InteractionRequiredError('Not signed in', 'signed out'));
    }
    if (this.needsReauth.has(`${accountId}|${tenantId}`)) {
      return Promise.reject(
        new InteractionRequiredError('Demo tenant requires MFA', 'MFA required (demo)'),
      );
    }
    return Promise.resolve(this.token());
  }

  acquireTokenInteractive(accountId: string, tenantId: string): Promise<AccessToken> {
    this.needsReauth.delete(`${accountId}|${tenantId}`);
    this.signedIn.add(accountId);
    return Promise.resolve(this.token());
  }
}
