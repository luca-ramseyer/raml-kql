import { gzipSync } from 'node:zlib';

/**
 * "Open query in Azure Portal Logs" (spec 06). Format verified 2026-09 against a share link in
 * Microsoft Learn ("Convert audit logs to an allowlist"): the query is gzipped, base64-encoded
 * and then URL-encoded twice; the resource ID is URL-encoded once. `#@{tenant}` must be the
 * tenant the user signs in to the portal with (the managing tenant for Lighthouse).
 */
export interface PortalQueryLink {
  tenantId: string;
  workspaceResourceId: string;
  query: string;
  /** ISO 8601 duration (e.g. `P1D`); omitted when the query sets its own time filter. */
  timespan?: string | undefined;
}

export function encodePortalQuery(query: string): string {
  const base64 = gzipSync(Buffer.from(query, 'utf8')).toString('base64');
  return encodeURIComponent(encodeURIComponent(base64));
}

export function portalQueryUrl(link: PortalQueryLink): string {
  const timespan =
    link.timespan !== undefined && /^P[0-9TDHMSW.]+$/.test(link.timespan)
      ? `/timespan/${link.timespan}`
      : '';
  return (
    `https://portal.azure.com/#@${encodeURIComponent(link.tenantId)}` +
    `/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView` +
    `/resourceId/${encodeURIComponent(link.workspaceResourceId)}` +
    `/source/LogsBlade.AnalyticsShareLinkToQuery/q/${encodePortalQuery(link.query)}${timespan}`
  );
}
