import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { isAllowedExternalUrl } from '../security/navigation';

import { encodePortalQuery, portalQueryUrl } from './portal';

describe('portal query links', () => {
  it('decodes the way Microsoft Learn share links do (gzip, base64, URL-encoded twice)', () => {
    // From the share link on Learn ("Convert audit logs to an allowlist").
    const learn =
      'H4sIAAAAAAAAA3MtS80r4apRKM9ILUpVCMnMTXVPzUstSixJTVGwS0zP1zBM0YRLu4IU%252B%252BSnK9jaKiiFZ%252Bal5JcXKzhWlRalKikk5qUoBOeXFiWngmXdS1OLSwKK8isqHdOBmpS4ABekrZVpAAAA';
    const decode = (q: string): string =>
      gunzipSync(Buffer.from(decodeURIComponent(decodeURIComponent(q)), 'base64')).toString('utf8');
    expect(decode(learn)).toContain('EventLog == "Windows Azure"');
    const query =
      'SigninLogs\n| where TimeGenerated > ago(1d)\n| where UserPrincipalName has "+/="';
    expect(decode(encodePortalQuery(query))).toBe(query);
  });

  it('builds an allowlisted Logs blade URL for the workspace and tenant', () => {
    const url = portalQueryUrl({
      tenantId: '00000000-0000-0000-0000-00000000c001',
      workspaceResourceId:
        '/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la-contoso-soc',
      query: 'Heartbeat | take 1',
      timespan: 'P1D',
    });
    expect(url).toMatch(
      /^https:\/\/portal\.azure\.com\/#@00000000-0000-0000-0000-00000000c001\/blade\/Microsoft_OperationsManagementSuite_Workspace\/Logs\.ReactView\/resourceId\/%2Fsubscriptions%2F00000000-0000-0000-0000-000000000501%2Fresourcegroups%2Frg%2Fproviders%2Fmicrosoft\.operationalinsights%2Fworkspaces%2Fla-contoso-soc\/source\/LogsBlade\.AnalyticsShareLinkToQuery\/q\/[A-Za-z0-9%]+\/timespan\/P1D$/,
    );
    expect(isAllowedExternalUrl(url)).toBe(true);
    // Custom ranges and "set in query" leave the timespan out.
    expect(
      portalQueryUrl({ tenantId: 't', workspaceResourceId: '/x', query: 'T', timespan: 'a/b' }),
    ).not.toContain('timespan');
  });
});
