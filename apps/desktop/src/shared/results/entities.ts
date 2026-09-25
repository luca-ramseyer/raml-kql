import type { EntityType } from '@raml-kql/pack-schema/extension-manifest';

/**
 * Entity detection for result cells (spec 07): known column names, confirmed by the value's
 * shape. Used for the `cellEntityType` context key and to pick enrichers.
 */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 =
  /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(([0-9a-f]{1,4}:){0,7}[0-9a-f]{0,4})?::(([0-9a-f]{1,4}:){0,7}[0-9a-f]{0,4})?)$/i;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL = /^[^\s@]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = (length: number) => new RegExp(`^[0-9a-f]{${String(length)}}$`, 'i');

const VALIDATORS: Record<EntityType, (value: string) => boolean> = {
  ip: (v) => IPV4.test(v) || (v.includes(':') && IPV6.test(v)),
  domain: (v) => DOMAIN.test(v),
  url: (v) => /^https?:\/\/\S+$/i.test(v),
  md5: (v) => HEX(32).test(v),
  sha1: (v) => HEX(40).test(v),
  sha256: (v) => HEX(64).test(v),
  upn: (v) => EMAIL.test(v),
  email: (v) => EMAIL.test(v),
  hostname: (v) => /^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9-]{1,63})*$/i.test(v),
  deviceId: (v) => HEX(40).test(v) || GUID.test(v),
  aadObjectId: (v) => GUID.test(v),
  tenantId: (v) => GUID.test(v),
};

/** Column names (lower case) and the entity they hold. */
const COLUMNS: [RegExp, EntityType][] = [
  [
    /^(ipaddress|clientip|remoteip|localip|sourceip|destinationip|callerip(address)?|srcip|dstip|ip|.*ipaddress)$/,
    'ip',
  ],
  [/^(sha256|initiatingprocesssha256|filehashsha256|.*sha256)$/, 'sha256'],
  [/^(sha1|initiatingprocesssha1|.*sha1)$/, 'sha1'],
  [/^(md5|initiatingprocessmd5|.*md5)$/, 'md5'],
  [/^(url|remoteurl|requesturl|.*url)$/, 'url'],
  [/^(domain|domainname|remotedomain|dnsquery|queriedname|senderfromdomain)$/, 'domain'],
  [/^(userprincipalname|upn|accountupn|initiatingprocessaccountupn|caller)$/, 'upn'],
  [/^(email|emailaddress|senderfromaddress|recipientemailaddress|sendermailfromaddress)$/, 'email'],
  [/^(devicename|computer|hostname|host|computername)$/, 'hostname'],
  [/^(deviceid|aaddeviceid)$/, 'deviceId'],
  [/^(userid|objectid|aadobjectid|accountobjectid|userobjectid)$/, 'aadObjectId'],
  [/^(tenantid|aadtenantid|_tenantid)$/, 'tenantId'],
];

export function detectEntity(column: string, value: unknown): EntityType | undefined {
  if (typeof value !== 'string' || value === '' || value.length > 2000) return undefined;
  const name = column.toLowerCase();
  for (const [pattern, type] of COLUMNS) {
    if (pattern.test(name) && VALIDATORS[type](value.trim())) return type;
  }
  // Unknown column names: only unambiguous shapes.
  const trimmed = value.trim();
  if (VALIDATORS.ip(trimmed)) return 'ip';
  if (VALIDATORS.sha256(trimmed)) return 'sha256';
  if (VALIDATORS.url(trimmed)) return 'url';
  return undefined;
}

/** A few words for prompts: "IP addresses", "SHA-256 hashes". */
export const ENTITY_LABELS: Record<EntityType, string> = {
  ip: 'IP addresses',
  domain: 'domains',
  url: 'URLs',
  md5: 'MD5 hashes',
  sha1: 'SHA-1 hashes',
  sha256: 'SHA-256 hashes',
  upn: 'user names',
  email: 'email addresses',
  hostname: 'host names',
  deviceId: 'device IDs',
  aadObjectId: 'Entra object IDs',
  tenantId: 'tenant IDs',
};
