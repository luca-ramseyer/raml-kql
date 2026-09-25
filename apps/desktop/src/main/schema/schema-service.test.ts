import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSchemaData } from '../../shared/schema/models';
import type { Workspace } from '../../shared/workspaces/models';

import { MemorySchemaCache } from './schema-cache';
import { SchemaService } from './schema-service';

function workspace(name: string): Workspace {
  return {
    resourceId: `/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/${name}`,
    name,
    customerId: '00000000-0000-0000-0000-000000000101',
    location: 'westeurope',
    tenantId: '00000000-0000-0000-0000-00000000c001',
    subscriptionId: '00000000-0000-0000-0000-000000000501',
    resourceGroup: 'rg',
    sentinel: true,
    paths: [],
    missing: false,
    enabled: true,
    tags: [],
  };
}

const schemaWith = (...tables: string[]): WorkspaceSchemaData => ({
  tables: tables.map((name) => ({ name, columns: [{ name: 'TimeGenerated', type: 'datetime' }] })),
  functions: [],
});

function setup(options: { cacheHours?: number; fail?: Set<string> } = {}) {
  const a = workspace('la-a');
  const b = workspace('la-b');
  const byId = new Map([a, b].map((w) => [w.resourceId, w]));
  const now = { value: new Date('2026-09-01T00:00:00Z') };
  const fetchSchema = vi.fn((w: Workspace) =>
    options.fail?.has(w.name) === true
      ? Promise.reject(new Error('Forbidden'))
      : Promise.resolve(
          w.name === 'la-a' ? schemaWith('Heartbeat', 'SigninLogs') : schemaWith('Heartbeat'),
        ),
  );
  const cache = new MemorySchemaCache();
  const service = new SchemaService({
    workspace: (id) => byId.get(id),
    fetchSchema,
    cache,
    cacheHours: () => options.cacheHours ?? 24,
    now: () => now.value,
  });
  return { service, fetchSchema, cache, a, b, now };
}

describe('SchemaService', () => {
  it('merges the schemas of the requested workspaces', async () => {
    const { service, a, b } = setup();
    const merged = await service.get({ resourceIds: [a.resourceId, b.resourceId.toUpperCase()] });
    expect(merged.loaded).toBe(2);
    expect(merged.failed).toBe(0);
    expect(merged.tables.map((t) => [t.name, t.available])).toEqual([
      ['Heartbeat', 2],
      ['SigninLogs', 1],
    ]);
  });

  it('uses the disk cache within the TTL and refetches after it or on refresh', async () => {
    const { service, fetchSchema, a, now } = setup({ cacheHours: 24 });
    await service.get({ resourceIds: [a.resourceId] });
    await service.get({ resourceIds: [a.resourceId] });
    expect(fetchSchema).toHaveBeenCalledTimes(1);

    await service.get({ resourceIds: [a.resourceId], refresh: true });
    expect(fetchSchema).toHaveBeenCalledTimes(2);

    now.value = new Date('2026-09-02T01:00:00Z');
    await service.get({ resourceIds: [a.resourceId] });
    expect(fetchSchema).toHaveBeenCalledTimes(3);
  });

  it('never caches with cacheHours 0', async () => {
    const { service, fetchSchema, a } = setup({ cacheHours: 0 });
    await service.get({ resourceIds: [a.resourceId] });
    await service.get({ resourceIds: [a.resourceId] });
    expect(fetchSchema).toHaveBeenCalledTimes(2);
  });

  it('counts failures and unknown workspaces, and falls back to a stale schema', async () => {
    const fail = new Set<string>();
    const { service, a, b, now } = setup({ fail });
    await service.get({ resourceIds: [a.resourceId] }); // cached now

    fail.add('la-a').add('la-b');
    now.value = new Date('2026-09-05T00:00:00Z'); // cache expired
    const merged = await service.get({ resourceIds: [a.resourceId, b.resourceId, '/unknown'] });
    expect(merged.loaded).toBe(1); // la-a from the stale cache
    expect(merged.failed).toBe(2);
  });

  it('coalesces concurrent requests for the same workspace', async () => {
    const { service, fetchSchema, a } = setup();
    await Promise.all([
      service.get({ resourceIds: [a.resourceId] }),
      service.get({ resourceIds: [a.resourceId] }),
    ]);
    expect(fetchSchema).toHaveBeenCalledTimes(1);
  });
});
