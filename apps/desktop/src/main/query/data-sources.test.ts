import { describe, expect, it, vi } from 'vitest';

import type { Workspace } from '../../shared/workspaces/models';

import { DataSourceRegistry, LOG_ANALYTICS_SOURCE } from './data-sources';

const request = (workspace: Partial<Workspace>) => ({
  workspace: { resourceId: 'w', ...workspace } as Workspace,
  token: 't',
  query: 'Heartbeat',
  timespan: undefined,
  timeoutSeconds: 10,
  requestId: 'r',
  signal: new AbortController().signal,
});

describe('DataSourceRegistry', () => {
  it('routes workspaces to their data source, Log Analytics by default', async () => {
    const registry = new DataSourceRegistry();
    const la = { execute: vi.fn(() => Promise.resolve({ tables: [] })) };
    const other = { execute: vi.fn(() => Promise.resolve({ tables: [] })) };
    registry.register(LOG_ANALYTICS_SOURCE, 'Log Analytics', la);
    const dispose = registry.register('contoso.splunk', 'Splunk', other);
    await registry.router().execute(request({}));
    await registry.router().execute(request({ dataSourceId: 'contoso.splunk' }));
    expect(la.execute).toHaveBeenCalledTimes(1);
    expect(other.execute).toHaveBeenCalledTimes(1);
    expect(registry.list().map((s) => s.id)).toEqual([LOG_ANALYTICS_SOURCE, 'contoso.splunk']);
    dispose();
    await expect(
      registry.router().execute(request({ dataSourceId: 'contoso.splunk' })),
    ).rejects.toThrow(/not available/);
    expect(() => registry.register(LOG_ANALYTICS_SOURCE, 'x', la)).toThrow(/already registered/);
  });
});
