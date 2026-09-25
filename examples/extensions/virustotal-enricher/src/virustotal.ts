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
