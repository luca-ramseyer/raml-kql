import type { Entity, EnrichmentResult } from '@raml-kql/extension-api';

/** IPinfo API (https://ipinfo.io/developers). Every call needs an access token. */
export const API = 'https://api.ipinfo.io';

/**
 * "lite" is the free plan: country and network owner. "lookup" is the Core plan and higher:
 * adds city, region, network type and the privacy flags.
 */
export type ApiKind = 'lite' | 'lookup';

/** The columns, in the order they appear. Every result has all of them, so columns are stable. */
export const FIELDS: Record<ApiKind, readonly string[]> = {
  lite: ['country', 'country_code', 'asn', 'as_name', 'as_domain'],
  lookup: [
    'country',
    'country_code',
    'region',
    'city',
    'asn',
    'as_name',
    'as_domain',
    'as_type',
    'hosting',
    'anonymous',
    'anycast',
    'mobile',
  ],
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:.]+$/;

/** The address in a form IPinfo accepts, or undefined when the value is not an IP address. */
export function normalizeIp(value: string): string | undefined {
  const ip = value
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/%.*$/, '') // IPv6 zone id, e.g. fe80::1%eth0
    .toLowerCase();
  const v4 = IPV4.exec(ip);
  if (v4 !== null) return v4.slice(1).every((part) => Number(part) <= 255) ? ip : undefined;
  return ip.includes(':') && IPV6.test(ip) ? ip : undefined;
}

function v4Octets(ip: string): number[] | undefined {
  const match = IPV4.exec(ip);
  return match === null ? undefined : match.slice(1).map(Number);
}

/**
 * Private, loopback, link-local, documentation and other reserved ranges. These are never sent:
 * IPinfo has nothing to say about them, and internal addresses should not leave the app.
 */
export function isReserved(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  const octets = v4Octets(mapped?.[1] ?? ip);
  if (octets !== undefined) {
    const [a = 0, b = 0, c = 0] = octets;
    return (
      a === 0 || // "this network"
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF, TEST-NET-1
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast and reserved
    );
  }
  if (ip === '::' || ip === '::1') return true;
  const [first = '', second = ''] = ip.split(':');
  const hextet = parseInt(first === '' ? '0' : first, 16);
  return (
    (hextet & 0xfe00) === 0xfc00 || // unique local
    (hextet & 0xffc0) === 0xfe80 || // link-local
    (hextet & 0xff00) === 0xff00 || // multicast
    (hextet === 0x2001 && parseInt(second === '' ? '0' : second, 16) === 0xdb8) // documentation
  );
}

/** API path and web page of an address. */
export function endpoints(ip: string, kind: ApiKind): { api: string; gui: string } {
  const path = encodeURIComponent(ip);
  return {
    api: kind === 'lite' ? `${API}/lite/${path}` : `${API}/lookup/${path}`,
    gui: `https://ipinfo.io/${path}`,
  };
}

type Value = string | number | boolean | null;

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** A result with every column of `kind`, empty unless `values` fills it. */
function row(
  entity: Entity,
  kind: ApiKind,
  values: Record<string, Value>,
  url?: string,
): EnrichmentResult {
  const fields: Record<string, Value> = {};
  for (const field of FIELDS[kind]) fields[field] = values[field] ?? null;
  for (const [field, value] of Object.entries(values)) fields[field] ??= value;
  return url === undefined ? { entity, fields } : { entity, fields, url };
}

/** The columns shown for an IPinfo answer. */
export function toResult(
  entity: Entity,
  kind: ApiKind,
  body: unknown,
  gui: string,
): EnrichmentResult {
  const data = (body ?? {}) as Record<string, unknown>;
  if (data['bogon'] === true) return row(entity, kind, { note: 'private or reserved address' });
  if (kind === 'lite') {
    return row(
      entity,
      kind,
      {
        country: text(data['country']),
        country_code: text(data['country_code']),
        asn: text(data['asn']),
        as_name: text(data['as_name']),
        as_domain: text(data['as_domain']),
      },
      gui,
    );
  }
  const geo = (data['geo'] ?? {}) as Record<string, unknown>;
  const as = (data['as'] ?? {}) as Record<string, unknown>;
  const values: Record<string, Value> = {
    country: text(geo['country']),
    country_code: text(geo['country_code']),
    region: text(geo['region']),
    city: text(geo['city']),
    asn: text(as['asn']),
    as_name: text(as['name']),
    as_domain: text(as['domain']),
    as_type: text(as['type']),
    hosting: flag(data['is_hosting']),
    anonymous: flag(data['is_anonymous']),
    anycast: flag(data['is_anycast']),
    mobile: flag(data['is_mobile']),
  };
  // Plus and higher name the privacy service and say which kind it is.
  const anonymous = data['anonymous'];
  if (typeof anonymous === 'object' && anonymous !== null) {
    const details = anonymous as Record<string, unknown>;
    values['vpn'] = flag(details['is_vpn']);
    values['proxy'] = flag(details['is_proxy']);
    values['tor'] = flag(details['is_tor']);
    values['relay'] = flag(details['is_relay']);
    values['privacy_service'] = text(details['name']);
  }
  return row(entity, kind, values, gui);
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
  api: ApiKind;
  /** At most this many NEW lookups per run. */
  limit: number;
  requestsPerMinute: number;
  /** Stop starting new lookups after this long, so the host's call timeout is never hit. */
  budgetMs: number;
}

export type StopReason = 'done' | 'quota' | 'budget' | 'limit' | 'cancelled';

export interface RunOutcome {
  /** Answers for every value that has one, including earlier runs' (the cache). */
  results: EnrichmentResult[];
  /** Values asked from IPinfo in this run. */
  lookedUp: number;
  /** Values that still have no answer. Run the enrichment again to continue. */
  remaining: number;
  stopped: StopReason;
}

/**
 * Looks addresses up one by one, paced to `requestsPerMinute`. Private and reserved addresses
 * are answered locally and never sent. Nothing is thrown away when the quota or the time budget
 * runs out: the answers so far are returned, and kept in `cache` so the next run only asks for
 * the values still missing.
 */
export async function enrichEntities(
  entities: readonly Entity[],
  token: string,
  cache: Map<string, EnrichmentResult>,
  deps: LookupDeps,
  options: RunOptions,
): Promise<RunOutcome> {
  const kind = options.api;
  // The API is part of the key: switching from lite to lookup asks again for the extra columns.
  const cacheKey = (ip: string): string => `${kind}:${ip}`;
  const known: { entity: Entity; ip: string }[] = [];
  for (const entity of entities) {
    const ip = entity.type === 'ip' ? normalizeIp(entity.value) : undefined;
    if (ip !== undefined) known.push({ entity, ip });
  }
  for (const { entity, ip } of known) {
    if (isReserved(ip) && !cache.has(cacheKey(ip))) {
      cache.set(cacheKey(ip), row(entity, kind, { note: 'private or reserved address' }));
    }
  }
  const pending = known.filter(({ ip }) => !cache.has(cacheKey(ip)));
  const interval = 60_000 / Math.max(options.requestsPerMinute, 0.001);
  const started = deps.now();
  const asked = new Set<string>();
  let lastRequest: number | undefined;
  let lookedUp = 0;
  let stopped: StopReason = 'done';

  for (const { entity, ip } of pending) {
    if (asked.has(ip)) continue; // The same address twice in one selection.
    if (deps.isCancelled()) {
      stopped = 'cancelled';
      break;
    }
    if (lookedUp >= options.limit) {
      stopped = 'limit';
      break;
    }
    const wait = lastRequest === undefined ? 0 : Math.max(lastRequest + interval - deps.now(), 0);
    if (deps.now() + wait - started > options.budgetMs) {
      stopped = 'budget';
      break;
    }
    if (wait > 0) {
      await deps.sleep(wait);
      if (deps.isCancelled()) {
        stopped = 'cancelled';
        break;
      }
    }
    const target = endpoints(ip, kind);
    asked.add(ip);
    lastRequest = deps.now();
    lookedUp += 1;
    // The token goes in a header, never in the URL: URLs show up in Network Activity.
    const response = await deps.fetch(target.api, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        kind === 'lite'
          ? 'IPinfo refused the access token. Run "IPinfo: Set Access Token…".'
          : 'IPinfo refused the access token for the lookup API. Run "IPinfo: Set Access Token…", or set ipinfo-enricher.api to "lite" if your plan is the free Lite plan.',
      );
    }
    if (response.status === 429) {
      // Out of quota: keep what we have instead of failing the whole enrichment.
      lookedUp -= 1;
      stopped = 'quota';
      break;
    }
    if (response.ok) {
      cache.set(cacheKey(ip), toResult(entity, kind, await response.json(), target.gui));
    } else if (response.status === 400 || response.status === 404) {
      cache.set(cacheKey(ip), row(entity, kind, { note: 'unknown to IPinfo' }, target.gui));
    } else {
      // Not cached: a later run tries this value again.
      cache.set(
        `error:${cacheKey(ip)}`,
        row(entity, kind, { note: `error ${String(response.status)}` }),
      );
    }
  }

  const results: EnrichmentResult[] = [];
  let remaining = 0;
  for (const { entity, ip } of known) {
    const hit = cache.get(cacheKey(ip)) ?? cache.get(`error:${cacheKey(ip)}`);
    if (hit === undefined) remaining += 1;
    // The cached answer may have been found for another spelling of the same address.
    else results.push({ ...hit, entity });
  }
  return { results, lookedUp, remaining, stopped };
}
