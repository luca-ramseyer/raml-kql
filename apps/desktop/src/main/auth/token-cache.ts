/** An access token. Never leaves the main process and is never logged. */
export interface AccessToken {
  readonly token: string;
  readonly expiresOn: Date;
}

/** Refresh tokens this long before they expire (spec 02). */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * In-memory token cache keyed by (account, tenant, resource). Tokens are reused until
 * 5 minutes before expiry, and concurrent requests for the same key share one fetch.
 */
export class TokenCache {
  private readonly tokens = new Map<string, AccessToken>();
  private readonly inflight = new Map<string, Promise<AccessToken>>();

  constructor(private readonly now: () => number = Date.now) {}

  static key(accountId: string, tenantId: string, resource: string): string {
    return JSON.stringify([accountId, tenantId.toLowerCase(), resource]);
  }

  async getOrFetch(key: string, fetch: () => Promise<AccessToken>): Promise<AccessToken> {
    const cached = this.tokens.get(key);
    if (cached !== undefined && cached.expiresOn.getTime() - REFRESH_MARGIN_MS > this.now()) {
      return cached;
    }
    const pending = this.inflight.get(key);
    if (pending !== undefined) return pending;

    const request = fetch()
      .then((token) => {
        this.tokens.set(key, token);
        return token;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  /** Drop every token for an account (sign-out must take effect immediately). */
  clearAccount(accountId: string): void {
    for (const key of [...this.tokens.keys()]) {
      if ((JSON.parse(key) as string[])[0] === accountId) this.tokens.delete(key);
    }
  }

  clear(): void {
    this.tokens.clear();
  }

  get size(): number {
    return this.tokens.size;
  }
}
