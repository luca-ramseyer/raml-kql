import type { Entity, EnrichmentResult } from '@raml-kql/extension-api';
import { describe, expect, it } from 'vitest';

import { enrichEntities, endpoints, toResult, urlId, type LookupDeps } from './virustotal';

describe('VirusTotal helpers', () => {
  it('builds API and web URLs per entity type', () => {
    expect(endpoints({ type: 'ip', value: '203.0.113.7' })?.api).toBe(
      'https://www.virustotal.com/api/v3/ip_addresses/203.0.113.7',
    );
    expect(endpoints({ type: 'sha256', value: 'A'.repeat(64) })?.gui).toBe(
      `https://www.virustotal.com/gui/file/${'a'.repeat(64)}`,
    );
    expect(endpoints({ type: 'upn', value: 'alice@contoso.com' })).toBeUndefined();
  });

  it('encodes URL ids as unpadded base64url', () => {
    const url = 'http://www.contoso.example/path?q=ä~';
    expect(urlId(url)).toBe(Buffer.from(url).toString('base64url'));
  });

  it('summarises analysis stats', () => {
    const result = toResult(
      { type: 'ip', value: '203.0.113.7' },
      {
        data: {
          attributes: {
            reputation: -5,
            last_analysis_stats: { malicious: 3, suspicious: 1, harmless: 60, undetected: 26 },
          },
        },
      },
      'https://www.virustotal.com/gui/ip-address/203.0.113.7',
    );
    expect(result.fields).toEqual({ malicious: 3, verdict: '3/90', reputation: -5 });
  });
});

/** A fake VirusTotal and a fake clock, so pacing can be tested without waiting. */
function fakes(statuses: (call: number, url: string) => number) {
  let clock = 0;
  const calls: { url: string; at: number }[] = [];
  const deps: LookupDeps & { cancelled: boolean } = {
    cancelled: false,
    fetch: (url) => {
      calls.push({ url, at: clock });
      const status = statuses(calls.length, url);
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () =>
          Promise.resolve({
            data: { attributes: { last_analysis_stats: { malicious: 2, harmless: 8 } } },
          }),
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

const ips = (count: number): Entity[] =>
  Array.from({ length: count }, (_, i) => ({ type: 'ip', value: `203.0.113.${String(i + 1)}` }));
const options = { limit: 25, requestsPerMinute: 4, budgetMs: 90_000 };

describe('enrichEntities', () => {
  it('paces lookups to the key rate instead of hitting the quota', async () => {
    const { deps, calls } = fakes(() => 200);
    const outcome = await enrichEntities(
      ips(4),
      'key',
      new Map<string, EnrichmentResult>(),
      deps,
      options,
    );
    expect(outcome.results).toHaveLength(4);
    expect(outcome.stopped).toBe('done');
    // 4 per minute: one request every 15 seconds.
    expect(calls.map((c) => c.at)).toEqual([0, 15_000, 30_000, 45_000]);
  });

  it('stops before the time budget runs out and keeps the answers', async () => {
    const { deps } = fakes(() => 200);
    const outcome = await enrichEntities(
      ips(25),
      'key',
      new Map<string, EnrichmentResult>(),
      deps,
      options,
    );
    expect(outcome.stopped).toBe('budget');
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.length + outcome.remaining).toBe(25);
    expect(outcome.lookedUp).toBe(7); // 0, 15, 30, 45, 60, 75, 90 seconds
  });

  it('keeps earlier answers when the quota is exhausted (429), without throwing', async () => {
    const { deps } = fakes((call) => (call <= 2 ? 200 : 429));
    const cache = new Map<string, EnrichmentResult>();
    const outcome = await enrichEntities(ips(5), 'key', cache, deps, {
      ...options,
      requestsPerMinute: 1000,
    });
    expect(outcome.stopped).toBe('quota');
    expect(outcome.results).toHaveLength(2);
    expect(outcome.remaining).toBe(3);
    expect(outcome.lookedUp).toBe(2);
  });

  it('continues where the last run stopped: cached values are not asked again', async () => {
    const cache = new Map<string, EnrichmentResult>();
    const first = fakes((call) => (call <= 2 ? 200 : 429));
    await enrichEntities(ips(4), 'key', cache, first.deps, { ...options, requestsPerMinute: 1000 });
    const second = fakes(() => 200);
    const outcome = await enrichEntities(ips(4), 'key', cache, second.deps, {
      ...options,
      requestsPerMinute: 1000,
    });
    expect(second.calls).toHaveLength(2); // only the two missing values
    expect(outcome.results).toHaveLength(4);
    expect(outcome.remaining).toBe(0);
  });

  it('honours the per-run limit and cancellation', async () => {
    const limited = fakes(() => 200);
    const outcome = await enrichEntities(
      ips(10),
      'key',
      new Map<string, EnrichmentResult>(),
      limited.deps,
      {
        limit: 3,
        requestsPerMinute: 1000,
        budgetMs: 90_000,
      },
    );
    expect(outcome.stopped).toBe('limit');
    expect(outcome.lookedUp).toBe(3);

    const cancelling = fakes(() => 200);
    cancelling.deps.cancelled = true;
    const cancelled = await enrichEntities(
      ips(3),
      'key',
      new Map<string, EnrichmentResult>(),
      cancelling.deps,
      options,
    );
    expect(cancelled.stopped).toBe('cancelled');
    expect(cancelling.calls).toHaveLength(0);
  });

  it('reports unknown values, and fails clearly when the key is refused', async () => {
    const unknown = fakes(() => 404);
    const outcome = await enrichEntities(
      ips(1),
      'key',
      new Map<string, EnrichmentResult>(),
      unknown.deps,
      options,
    );
    expect(outcome.results[0]?.fields['verdict']).toBe('unknown to VirusTotal');

    const refused = fakes(() => 401);
    await expect(
      enrichEntities(ips(1), 'bad', new Map<string, EnrichmentResult>(), refused.deps, options),
    ).rejects.toThrow(/refused the API key/);
  });

  it('ignores values VirusTotal has no endpoint for', async () => {
    const { deps, calls } = fakes(() => 200);
    const outcome = await enrichEntities(
      [{ type: 'upn', value: 'alice@contoso.example' }],
      'key',
      new Map<string, EnrichmentResult>(),
      deps,
      options,
    );
    expect(outcome.results).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
