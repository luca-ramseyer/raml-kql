import type { Entity, EnrichmentResult } from '@raml-kql/extension-api';
import { describe, expect, it } from 'vitest';

import {
  enrichEntities,
  endpoints,
  isReserved,
  normalizeIp,
  toResult,
  type LookupDeps,
  type RunOptions,
} from './ipinfo';

describe('IPinfo helpers', () => {
  it('normalises IPv4 and IPv6 addresses and rejects other values', () => {
    expect(normalizeIp(' 8.8.8.8 ')).toBe('8.8.8.8');
    expect(normalizeIp('[2001:4860:4860::8888]')).toBe('2001:4860:4860::8888');
    expect(normalizeIp('FE80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('256.1.1.1')).toBeUndefined();
    expect(normalizeIp('contoso.example')).toBeUndefined();
  });

  it('recognises private and reserved ranges', () => {
    for (const ip of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.10.10',
      '100.64.0.1',
      '203.0.113.7',
      '198.51.100.1',
      '224.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '2001:db8::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isReserved(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888']) {
      expect(isReserved(ip), ip).toBe(false);
    }
  });

  it('builds API and web URLs per API kind', () => {
    expect(endpoints('8.8.8.8', 'lite')).toEqual({
      api: 'https://api.ipinfo.io/lite/8.8.8.8',
      gui: 'https://ipinfo.io/8.8.8.8',
    });
    expect(endpoints('2001:4860:4860::8888', 'lookup').api).toBe(
      'https://api.ipinfo.io/lookup/2001%3A4860%3A4860%3A%3A8888',
    );
  });

  it('maps a Lite answer to columns', () => {
    const result = toResult(
      { type: 'ip', value: '8.8.8.8' },
      'lite',
      {
        ip: '8.8.8.8',
        asn: 'AS15169',
        as_name: 'Google LLC',
        as_domain: 'google.com',
        country_code: 'US',
        country: 'United States',
        continent_code: 'NA',
        continent: 'North America',
      },
      'https://ipinfo.io/8.8.8.8',
    );
    expect(result.fields).toEqual({
      country: 'United States',
      country_code: 'US',
      asn: 'AS15169',
      as_name: 'Google LLC',
      as_domain: 'google.com',
    });
    expect(result.url).toBe('https://ipinfo.io/8.8.8.8');
  });

  it('maps a lookup answer, including the privacy details of higher plans', () => {
    const body = {
      ip: '192.0.2.200',
      geo: { city: 'Contoso City', region: 'Fabrikam', country: 'Woodgrove', country_code: 'WG' },
      as: { asn: 'AS64500', name: 'Contoso Hosting', domain: 'contoso.example', type: 'hosting' },
      is_anonymous: true,
      is_anycast: false,
      is_hosting: true,
      is_mobile: false,
    };
    const core = toResult({ type: 'ip', value: '192.0.2.200' }, 'lookup', body, 'gui');
    expect(core.fields).toEqual({
      country: 'Woodgrove',
      country_code: 'WG',
      region: 'Fabrikam',
      city: 'Contoso City',
      asn: 'AS64500',
      as_name: 'Contoso Hosting',
      as_domain: 'contoso.example',
      as_type: 'hosting',
      hosting: true,
      anonymous: true,
      anycast: false,
      mobile: false,
    });
    const plus = toResult(
      { type: 'ip', value: '192.0.2.200' },
      'lookup',
      { ...body, anonymous: { name: 'Contoso VPN', is_vpn: true, is_proxy: false } },
      'gui',
    );
    expect(plus.fields).toMatchObject({
      vpn: true,
      proxy: false,
      tor: null,
      privacy_service: 'Contoso VPN',
    });
  });

  it('keeps every column, empty, when IPinfo has no data', () => {
    const result = toResult({ type: 'ip', value: '8.8.8.8' }, 'lookup', { ip: '8.8.8.8' }, 'gui');
    expect(Object.keys(result.fields)).toHaveLength(12);
    expect(Object.values(result.fields).every((value) => value === null)).toBe(true);
    const bogon = toResult({ type: 'ip', value: '8.8.8.8' }, 'lite', { bogon: true }, 'gui');
    expect(bogon.fields['note']).toBe('private or reserved address');
  });
});

/** A fake IPinfo and a fake clock, so pacing can be tested without waiting. */
function fakes(statuses: (call: number, url: string) => number) {
  let clock = 0;
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  const deps: LookupDeps & { cancelled: boolean } = {
    cancelled: false,
    fetch: (url, init) => {
      calls.push({ url, at: clock, headers: init.headers });
      clock += 100; // Each request takes a tenth of a second.
      const status = statuses(calls.length, url);
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve({ country: 'Woodgrove', country_code: 'WG', asn: 'AS64500' }),
      });
    },
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    isCancelled: () => deps.cancelled,
  };
  return { deps, calls };
}

/** Public-looking addresses (not in any reserved range), all fake. */
const ips = (count: number): Entity[] =>
  Array.from({ length: count }, (_, i) => ({ type: 'ip', value: `8.8.4.${String(i + 1)}` }));
const options: RunOptions = { api: 'lite', limit: 500, requestsPerMinute: 600, budgetMs: 90_000 };

describe('enrichEntities', () => {
  it('sends the token in a header, never in the URL', async () => {
    const { deps, calls } = fakes(() => 200);
    await enrichEntities(ips(1), 'secret-token', new Map(), deps, options);
    expect(calls[0]?.url).toBe('https://api.ipinfo.io/lite/8.8.4.1');
    expect(calls[0]?.url).not.toContain('secret-token');
    expect(calls[0]?.headers['authorization']).toBe('Bearer secret-token');
  });

  it('answers private and reserved addresses locally without sending them', async () => {
    const { deps, calls } = fakes(() => 200);
    const outcome = await enrichEntities(
      [
        { type: 'ip', value: '10.0.0.5' },
        { type: 'ip', value: '203.0.113.7' },
        { type: 'ip', value: '8.8.4.4' },
      ],
      'token',
      new Map(),
      deps,
      options,
    );
    expect(calls.map((c) => c.url)).toEqual(['https://api.ipinfo.io/lite/8.8.4.4']);
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0]?.fields['note']).toBe('private or reserved address');
    expect(outcome.results[0]?.fields['country']).toBeNull();
    expect(outcome.lookedUp).toBe(1);
  });

  it('paces lookups to requestsPerMinute', async () => {
    const { deps, calls } = fakes(() => 200);
    await enrichEntities(ips(3), 'token', new Map(), deps, { ...options, requestsPerMinute: 60 });
    expect(calls.map((c) => c.at)).toEqual([0, 1000, 2000]);
  });

  it('asks once for an address that appears twice', async () => {
    const { deps, calls } = fakes(() => 200);
    const outcome = await enrichEntities(
      [
        { type: 'ip', value: '8.8.4.4' },
        { type: 'ip', value: ' 8.8.4.4' },
      ],
      'token',
      new Map(),
      deps,
      options,
    );
    expect(calls).toHaveLength(1);
    expect(outcome.results.map((r) => r.entity.value)).toEqual(['8.8.4.4', ' 8.8.4.4']);
  });

  it('stops at the time budget even when requests are slow, and keeps the answers', async () => {
    const { deps } = fakes(() => 200);
    const outcome = await enrichEntities(ips(200), 'token', new Map(), deps, {
      ...options,
      requestsPerMinute: 6000,
      budgetMs: 10_000,
    });
    expect(outcome.stopped).toBe('budget');
    expect(outcome.lookedUp).toBe(101); // One every 100 ms, from 0 to 10 seconds.
    expect(outcome.results.length + outcome.remaining).toBe(200);
  });

  it('keeps earlier answers when the quota is exhausted (429) and continues next run', async () => {
    const cache = new Map<string, EnrichmentResult>();
    const first = fakes((call) => (call <= 2 ? 200 : 429));
    const outcome = await enrichEntities(ips(4), 'token', cache, first.deps, options);
    expect(outcome.stopped).toBe('quota');
    expect(outcome.results).toHaveLength(2);
    expect(outcome.remaining).toBe(2);

    const second = fakes(() => 200);
    const next = await enrichEntities(ips(4), 'token', cache, second.deps, options);
    expect(second.calls).toHaveLength(2); // only the two missing values
    expect(next.remaining).toBe(0);
  });

  it('asks again when the API kind changes, for the extra columns', async () => {
    const cache = new Map<string, EnrichmentResult>();
    await enrichEntities(ips(1), 'token', cache, fakes(() => 200).deps, options);
    const lookup = fakes(() => 200);
    await enrichEntities(ips(1), 'token', cache, lookup.deps, { ...options, api: 'lookup' });
    expect(lookup.calls.map((c) => c.url)).toEqual(['https://api.ipinfo.io/lookup/8.8.4.1']);
  });

  it('honours the per-run limit and cancellation', async () => {
    const limited = fakes(() => 200);
    const outcome = await enrichEntities(ips(10), 'token', new Map(), limited.deps, {
      ...options,
      limit: 3,
    });
    expect(outcome.stopped).toBe('limit');
    expect(outcome.lookedUp).toBe(3);

    const cancelling = fakes(() => 200);
    cancelling.deps.cancelled = true;
    const cancelled = await enrichEntities(ips(3), 'token', new Map(), cancelling.deps, options);
    expect(cancelled.stopped).toBe('cancelled');
    expect(cancelling.calls).toHaveLength(0);
  });

  it('reports unknown values and retries errors, and fails clearly on a refused token', async () => {
    const unknown = fakes(() => 404);
    const outcome = await enrichEntities(ips(1), 'token', new Map(), unknown.deps, options);
    expect(outcome.results[0]?.fields['note']).toBe('unknown to IPinfo');

    const cache = new Map<string, EnrichmentResult>();
    const failing = fakes(() => 502);
    const failed = await enrichEntities(ips(1), 'token', cache, failing.deps, options);
    expect(failed.results[0]?.fields['note']).toBe('error 502');
    const retry = fakes(() => 200);
    await enrichEntities(ips(1), 'token', cache, retry.deps, options);
    expect(retry.calls).toHaveLength(1);

    await expect(
      enrichEntities(ips(1), 'bad', new Map(), fakes(() => 403).deps, options),
    ).rejects.toThrow(/refused the access token/);
    await expect(
      enrichEntities(ips(1), 'bad', new Map(), fakes(() => 403).deps, {
        ...options,
        api: 'lookup',
      }),
    ).rejects.toThrow(/ipinfo-enricher\.api to "lite"/);
  });

  it('ignores values that are not IP addresses', async () => {
    const { deps, calls } = fakes(() => 200);
    const outcome = await enrichEntities(
      [
        { type: 'domain', value: 'contoso.example' },
        { type: 'ip', value: 'not-an-ip' },
      ],
      'token',
      new Map(),
      deps,
      options,
    );
    expect(outcome.results).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
