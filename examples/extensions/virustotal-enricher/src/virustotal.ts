import type { Entity, EnrichmentResult } from '@raml-kql/extension-api';

/** VirusTotal API v3 (https://docs.virustotal.com/reference/overview). */
export const API = 'https://www.virustotal.com/api/v3';

/** URL identifiers are the URL, base64url-encoded without padding. */
export function urlId(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** API path and web page of an entity. */
export function endpoints(entity: Entity): { api: string; gui: string } | undefined {
  const value = entity.value.trim();
  switch (entity.type) {
    case 'ip':
      return {
        api: `${API}/ip_addresses/${encodeURIComponent(value)}`,
        gui: `https://www.virustotal.com/gui/ip-address/${encodeURIComponent(value)}`,
      };
    case 'domain':
      return {
        api: `${API}/domains/${encodeURIComponent(value)}`,
        gui: `https://www.virustotal.com/gui/domain/${encodeURIComponent(value)}`,
      };
    case 'url':
      return {
        api: `${API}/urls/${urlId(value)}`,
        gui: `https://www.virustotal.com/gui/url/${urlId(value)}`,
      };
    case 'sha256':
    case 'sha1':
    case 'md5':
      return {
        api: `${API}/files/${value.toLowerCase()}`,
        gui: `https://www.virustotal.com/gui/file/${value.toLowerCase()}`,
      };
    default:
      return undefined;
  }
}

interface AnalysisStats {
  malicious?: number;
  suspicious?: number;
  harmless?: number;
  undetected?: number;
}

/** The columns shown for a VirusTotal object. */
export function toResult(entity: Entity, body: unknown, gui: string): EnrichmentResult {
  const attributes = (
    body as { data?: { attributes?: { last_analysis_stats?: AnalysisStats; reputation?: number } } }
  ).data?.attributes;
  const stats = attributes?.last_analysis_stats ?? {};
  const total =
    (stats.malicious ?? 0) +
    (stats.suspicious ?? 0) +
    (stats.harmless ?? 0) +
    (stats.undetected ?? 0);
  return {
    entity,
    fields: {
      malicious: stats.malicious ?? 0,
      verdict: total === 0 ? 'not analysed' : `${String(stats.malicious ?? 0)}/${String(total)}`,
      reputation: attributes?.reputation ?? null,
    },
    url: gui,
  };
}

/** What `enrichEntities` needs from the outside, so it can be tested without a network. */
export interface LookupDeps {
  fetch(
    url: string,
    init: { headers: Record<string, string> },
  ): Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  isCancelled(): boolean;
}

export interface RunOptions {
  /** At most this many NEW lookups per run. */
  limit: number;
  /** The public API allows 4 per minute; premium keys allow far more. */
  requestsPerMinute: number;
  /** Stop starting new lookups after this long, so the host's call timeout is never hit. */
  budgetMs: number;
}

export type StopReason = 'done' | 'quota' | 'budget' | 'limit' | 'cancelled';

export interface RunOutcome {
  /** Answers for every value that has one, including earlier runs' (the cache). */
  results: EnrichmentResult[];
  /** Values asked from VirusTotal in this run. */
  lookedUp: number;
  /** Values that still have no answer. Run the enrichment again to continue. */
  remaining: number;
  stopped: StopReason;
}

/**
 * Looks values up one by one, paced to the key's rate limit. Nothing is thrown away when the
 * quota or the time budget runs out: the answers so far are returned, and answers are kept in
 * `cache` so the next run only asks for the values still missing.
 */
export async function enrichEntities(
  entities: readonly Entity[],
  key: string,
  cache: Map<string, EnrichmentResult>,
  deps: LookupDeps,
  options: RunOptions,
): Promise<RunOutcome> {
  const cacheKey = (entity: Entity): string => `${entity.type}:${entity.value.trim()}`;
  const known = entities.filter((entity) => endpoints(entity) !== undefined);
  const pending = known.filter((entity) => !cache.has(cacheKey(entity)));
  const interval = 60_000 / Math.max(options.requestsPerMinute, 0.001);
  const started = deps.now();
  let lastRequest: number | undefined;
  let lookedUp = 0;
  let stopped: StopReason = 'done';

  for (const entity of pending) {
    if (deps.isCancelled()) {
      stopped = 'cancelled';
      break;
    }
    if (lookedUp >= options.limit) {
      stopped = 'limit';
      break;
    }
    if (lastRequest !== undefined) {
      const wait = lastRequest + interval - deps.now();
      if (wait > 0) {
        if (deps.now() + wait - started > options.budgetMs) {
          stopped = 'budget';
          break;
        }
        await deps.sleep(wait);
        if (deps.isCancelled()) {
          stopped = 'cancelled';
          break;
        }
      }
    }
    const target = endpoints(entity);
    if (target === undefined) continue;
    lastRequest = deps.now();
    lookedUp += 1;
    const response = await deps.fetch(target.api, {
      headers: { 'x-apikey': key, accept: 'application/json' },
    });
    if (response.status === 401) {
      throw new Error('VirusTotal refused the API key. Run "VirusTotal: Set API Key…".');
    }
    if (response.status === 429) {
      // Out of quota: keep what we have instead of failing the whole enrichment.
      lookedUp -= 1;
      stopped = 'quota';
      break;
    }
    if (response.status === 404) {
      cache.set(cacheKey(entity), {
        entity,
        fields: { verdict: 'unknown to VirusTotal', malicious: null },
        url: target.gui,
      });
    } else if (response.ok) {
      cache.set(cacheKey(entity), toResult(entity, await response.json(), target.gui));
    } else {
      // Not cached: a later run tries this value again.
      cache.set(`error:${cacheKey(entity)}`, {
        entity,
        fields: { verdict: `error ${String(response.status)}`, malicious: null },
      });
    }
  }

  const results: EnrichmentResult[] = [];
  let remaining = 0;
  for (const entity of known) {
    const hit = cache.get(cacheKey(entity)) ?? cache.get(`error:${cacheKey(entity)}`);
    if (hit === undefined) remaining += 1;
    else results.push(hit);
  }
  return { results, lookedUp, remaining, stopped };
}
