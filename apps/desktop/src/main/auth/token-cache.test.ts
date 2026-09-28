import { describe, expect, it, vi } from 'vitest';

import { REFRESH_MARGIN_MS, TokenCache, type AccessToken } from './token-cache';

const token = (value: string, expiresAt: number): AccessToken => ({
  token: value,
  expiresOn: new Date(expiresAt),
});

describe('TokenCache', () => {
  it('reuses a token until 5 minutes before it expires', async () => {
    let now = 0;
    const cache = new TokenCache(() => now);
    const fetch = vi.fn(() => Promise.resolve(token('a', 60 * 60 * 1000)));
    const key = TokenCache.key('acc', 'TENANT', 'arm');
    await cache.getOrFetch(key, fetch);
    now = 60 * 60 * 1000 - REFRESH_MARGIN_MS - 1;
    await cache.getOrFetch(key, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 2;
    await cache.getOrFetch(key, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests for the same key into one fetch', async () => {
    const cache = new TokenCache(() => 0);
    let resolve: (t: AccessToken) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<AccessToken>((r) => (resolve = r)));
    const key = TokenCache.key('acc', 't', 'logAnalytics');
    const all = Promise.all([
      cache.getOrFetch(key, fetch),
      cache.getOrFetch(key, fetch),
      cache.getOrFetch(key, fetch),
    ]);
    resolve(token('shared', 10 ** 9));
    expect((await all).map((t) => t.token)).toEqual(['shared', 'shared', 'shared']);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not cache failures', async () => {
    const cache = new TokenCache(() => 0);
    const key = TokenCache.key('acc', 't', 'arm');
    await expect(cache.getOrFetch(key, () => Promise.reject(new Error('mfa')))).rejects.toThrow(
      'mfa',
    );
    await expect(
      cache.getOrFetch(key, () => Promise.resolve(token('ok', 10 ** 9))),
    ).resolves.toMatchObject({ token: 'ok' });
  });

  it('keys by tenant case-insensitively and clears per account', async () => {
    const cache = new TokenCache(() => 0);
    await cache.getOrFetch(TokenCache.key('a', 'T1', 'arm'), () =>
      Promise.resolve(token('1', 10 ** 9)),
    );
    await cache.getOrFetch(TokenCache.key('b', 't1', 'arm'), () =>
      Promise.resolve(token('2', 10 ** 9)),
    );
    expect(TokenCache.key('a', 'T1', 'arm')).toBe(TokenCache.key('a', 't1', 'arm'));
    cache.clearAccount('a');
    expect(cache.size).toBe(1);
  });
});
