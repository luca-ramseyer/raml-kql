import type { ResultColumn } from '../query/models';
import { valueText } from '../results/values';

/**
 * Row-level links (spec 06): well-known columns that point at a page in the Microsoft portals.
 * A small registry so extensions can add more (spec 07). Only https URLs on the external URL
 * allowlist can be opened; anything else is dropped here already.
 */
export interface RowLink {
  label: string;
  url: string;
}

export interface RowLinkProvider {
  /** Column the link is built from. */
  column: string;
  label: string;
  build(value: string, row: RowAccessor): string | undefined;
}

export type RowAccessor = (column: string) => unknown;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_HOSTS = new Set(['portal.azure.com', 'security.microsoft.com']);

/** An existing URL in a result cell, if it points at an allowed portal. */
function portalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LINK_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const ROW_LINK_PROVIDERS: RowLinkProvider[] = [
  { column: 'IncidentUrl', label: 'Open Incident', build: (value) => portalUrl(value) },
  { column: 'AlertLink', label: 'Open Alert', build: (value) => portalUrl(value) },
  { column: 'AlertUrl', label: 'Open Alert', build: (value) => portalUrl(value) },
  {
    column: 'DeviceId',
    label: 'Open Device in Microsoft Defender',
    build: (value, row) => {
      // Defender device IDs are 40 hex characters.
      if (!/^[0-9a-f]{40}$/i.test(value)) return undefined;
      const tenant = valueText(row('_TenantId'));
      return `https://security.microsoft.com/machines/${value}${GUID.test(tenant) ? `?tid=${tenant}` : ''}`;
    },
  },
];

export function rowLinks(columns: readonly ResultColumn[], row: readonly unknown[]): RowLink[] {
  const get: RowAccessor = (name) => row[columns.findIndex((c) => c.name === name)];
  return ROW_LINK_PROVIDERS.flatMap((provider) => {
    const index = columns.findIndex((c) => c.name === provider.column);
    if (index < 0) return [];
    const value = valueText(row[index]).trim();
    if (value === '') return [];
    const url = provider.build(value, get);
    return url === undefined ? [] : [{ label: provider.label, url }];
  });
}
