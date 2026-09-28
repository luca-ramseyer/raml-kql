import { afterEach, describe, expect, it } from 'vitest';

import { startFakeAzure, type FakeAzure } from '../../../test/fake-azure/server';
import { PUBLIC_CLOUD } from '../auth/cloud';

import { ArmRequestError } from './arm-tenants';
import { DISCOVERY_QUERIES, hasSentinelOnboarding, queryResourceGraph } from './resource-graph';

let fake: FakeAzure | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe('queryResourceGraph against the fake Azure server', () => {
  it('follows $skipToken until all rows are read', async () => {
    const workspaces = Array.from({ length: 5 }, (_, i) => ({
      id: `/subscriptions/s/workspaces/ws${String(i)}`,
      name: `ws${String(i)}`,
    }));
    fake = await startFakeAzure({
      tenantsByToken: { t: [] },
      resourceGraphByToken: { t: { workspaces } },
      resourceGraphPageSize: 2,
    });
    const rows = await queryResourceGraph({
      cloud: { ...PUBLIC_CLOUD, armEndpoint: fake.url },
      token: 't',
      query: DISCOVERY_QUERIES.workspaces,
    });
    expect(rows.map((r) => r['name'])).toEqual(['ws0', 'ws1', 'ws2', 'ws3', 'ws4']);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(3);
    expect(fake.requests[0]?.path).toContain('api-version=2024-04-01');
  });

  it('reports HTTP failures', async () => {
    fake = await startFakeAzure({ tenantsByToken: { t: [] }, failNext: { status: 429, count: 1 } });
    await expect(
      queryResourceGraph({
        cloud: { ...PUBLIC_CLOUD, armEndpoint: fake.url },
        token: 't',
        query: 'resources',
      }),
    ).rejects.toBeInstanceOf(ArmRequestError);
  });
});

describe('hasSentinelOnboarding', () => {
  const id =
    '/subscriptions/s/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/la';

  it('is true for 200 and false otherwise, including network errors', async () => {
    const seen: string[] = [];
    const ok = await hasSentinelOnboarding({
      cloud: PUBLIC_CLOUD,
      token: 't',
      workspaceResourceId: id,
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      },
    });
    expect(ok).toBe(true);
    expect(seen[0]).toBe(
      `https://management.azure.com${id}/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=2025-09-01`,
    );
    expect(
      await hasSentinelOnboarding({
        cloud: PUBLIC_CLOUD,
        token: 't',
        workspaceResourceId: id,
        fetch: () => Promise.resolve(new Response('', { status: 404 })),
      }),
    ).toBe(false);
    expect(
      await hasSentinelOnboarding({
        cloud: PUBLIC_CLOUD,
        token: 't',
        workspaceResourceId: id,
        fetch: () => Promise.reject(new Error('offline')),
      }),
    ).toBe(false);
  });
});
