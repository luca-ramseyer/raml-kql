import { afterEach, describe, expect, it } from 'vitest';

import { startFakeAzure, type FakeAzure } from '../../../test/fake-azure/server';
import { PUBLIC_CLOUD } from '../auth/cloud';

import { ArmRequestError, listTenants } from './arm-tenants';

const HOME = '00000000-0000-0000-0000-0000000000a1';

let fake: FakeAzure | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const cloudFor = (server: FakeAzure) => ({ ...PUBLIC_CLOUD, armEndpoint: server.url });

describe('listTenants against the fake Azure server', () => {
  it('pages through nextLink and maps tenant categories to relations', async () => {
    fake = await startFakeAzure({
      pageSize: 2,
      tenantsByToken: {
        'token-a': [
          { tenantId: HOME.toUpperCase(), displayName: 'Contoso', tenantCategory: 'Home' },
          {
            tenantId: '00000000-0000-0000-0000-0000000000b2',
            displayName: 'Northwind',
            tenantCategory: 'Home',
          },
          {
            tenantId: '00000000-0000-0000-0000-0000000000c3',
            displayName: 'Fabrikam',
            tenantCategory: 'ProjectedBy',
          },
        ],
      },
    });
    const tenants = await listTenants({
      cloud: cloudFor(fake),
      token: 'token-a',
      homeTenantId: HOME,
    });
    expect(tenants).toEqual([
      { tenantId: HOME, displayName: 'Contoso', defaultDomain: undefined, relation: 'home' },
      {
        tenantId: '00000000-0000-0000-0000-0000000000b2',
        displayName: 'Northwind',
        defaultDomain: undefined,
        relation: 'guest',
      },
      {
        tenantId: '00000000-0000-0000-0000-0000000000c3',
        displayName: 'Fabrikam',
        defaultDomain: undefined,
        relation: 'lighthouse',
      },
    ]);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests.every((r) => r.authorization === 'Bearer token-a')).toBe(true);
  });

  it('never follows a nextLink to another origin (the token must not leak)', async () => {
    const pages = [
      { value: [{ tenantId: HOME }], nextLink: 'https://evil.example/tenants?steal=1' },
    ];
    const seen: string[] = [];
    const tenants = await listTenants({
      cloud: PUBLIC_CLOUD,
      token: 't',
      homeTenantId: HOME,
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(
          new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 }),
        );
      },
    });
    expect(tenants).toHaveLength(1);
    expect(seen).toEqual(['https://management.azure.com/tenants?api-version=2022-12-01']);
  });

  it('turns HTTP errors into ArmRequestError', async () => {
    fake = await startFakeAzure({ tenantsByToken: { t: [] }, failNext: { status: 503, count: 1 } });
    await expect(
      listTenants({ cloud: cloudFor(fake), token: 't', homeTenantId: HOME }),
    ).rejects.toBeInstanceOf(ArmRequestError);
    await expect(
      listTenants({ cloud: cloudFor(fake), token: 'unknown', homeTenantId: HOME }),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
