import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startFakeAzure,
  type FakeAzure,
  type FakeLogAnalyticsWorkspace,
} from '../../../test/fake-azure/server';
import { AppError } from '../../shared/errors';
import type { RunSnapshot } from '../../shared/query/models';
import type { AccessPath, Workspace } from '../../shared/workspaces/models';
import { AuditLog } from '../audit/audit-log';
import type { TokenRequest } from '../auth/auth-service';
import { PUBLIC_CLOUD } from '../auth/cloud';
import { AzureHttp } from '../azure/azure-http';
import { executeLogAnalyticsQuery } from '../azure/log-analytics-query';
import { ResultStore } from '../results/result-store';

import {
  QueryEngine,
  roundRobinByTenant,
  mostCommonRender,
  type EngineSettings,
} from './query-engine';
import { Scheduler } from './scheduler';

/**
 * Phase 5 acceptance: engine integration tests against a fake Log Analytics server — success,
 * 429 with Retry-After, 5xx retry, timeout, partial error, cancellation and row-cap truncation.
 */

const TENANT_A = '00000000-0000-0000-0000-00000000c001';
const TENANT_B = '00000000-0000-0000-0000-00000000c004';

function path_(accountId: string, tenant = TENANT_A): AccessPath {
  return { accountId, authorityTenantId: tenant, via: 'home' };
}

function workspace(n: number, options: { tenant?: string; paths?: AccessPath[] } = {}): Workspace {
  const tenant = options.tenant ?? TENANT_A;
  return {
    resourceId: `/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la-${String(n)}`,
    name: `la-${String(n)}`,
    customerId: `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`,
    location: 'westeurope',
    tenantId: tenant,
    subscriptionId: '00000000-0000-0000-0000-000000000501',
    subscriptionName: 'SOC-Prod',
    resourceGroup: 'rg',
    sentinel: true,
    paths: options.paths ?? [path_('acct-a', tenant)],
    missing: false,
    enabled: true,
    tags: [],
  };
}

const TABLE = {
  name: 'PrimaryResult',
  columns: [
    { name: 'TimeGenerated', type: 'datetime' },
    { name: 'Computer', type: 'string' },
  ],
  rows: [
    ['2026-09-01T00:00:00Z', 'ws-001'],
    ['2026-09-01T01:00:00Z', 'ws-002'],
  ],
};

function la(overrides: Partial<FakeLogAnalyticsWorkspace> = {}): FakeLogAnalyticsWorkspace {
  return { tokens: ['token-acct-a'], tables: [TABLE], ...overrides };
}

let fake: FakeAzure | undefined;
let dir: string | undefined;
const stores: ResultStore[] = [];

afterEach(async () => {
  await fake?.close();
  fake = undefined;
  for (const store of stores.splice(0)) store.dispose();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function setup(options: {
  workspaces: Workspace[];
  la: Record<string, FakeLogAnalyticsWorkspace>;
  settings?: Partial<EngineSettings>;
  perPrincipal?: number;
  maxMergedRows?: number;
  getToken?: (request: TokenRequest) => Promise<{ token: string; expiresOn: Date }>;
}) {
  fake = await startFakeAzure({ tenantsByToken: {}, logAnalytics: options.la });
  dir = mkdtempSync(path.join(tmpdir(), 'rk-engine-'));
  const store = ResultStore.create(path.join(dir, 'session-cache'), {
    memoryBudgetBytes: () => 1024 * 1024,
    maxMergedRows: () => options.maxMergedRows ?? 1_000_000,
  });
  stores.push(store);
  const audit = new AuditLog({
    dir: path.join(dir, 'audit'),
    appVersion: '0.0.0-test',
    enabled: () => true,
    includeQueryText: () => true,
    retentionMonths: () => 12,
  });
  const http = new AzureHttp({
    fetch: (url, init) => fetch(url, init),
    appName: 'RamlKQL',
    appVersion: '0.0.0-test',
  });
  const cloud = { ...PUBLIC_CLOUD, logAnalyticsEndpoint: fake.url };
  const byId = new Map(options.workspaces.map((w) => [w.resourceId, w]));
  const getToken = vi.fn(
    options.getToken ??
      ((request: TokenRequest) =>
        Promise.resolve({
          token: `token-${request.accountId}`,
          expiresOn: new Date(Date.now() + 3_600_000),
        })),
  );
  const snapshots: RunSnapshot[] = [];
  const engine = new QueryEngine({
    workspace: (id) => byId.get(id),
    tenantName: (id) => (id === TENANT_A ? 'Contoso' : 'Fabrikam'),
    accountName: (id) => `${id}@contoso.example`,
    getToken,
    source: {
      execute: (request) =>
        executeLogAnalyticsQuery({
          cloud,
          fetch: http.fetch,
          token: request.token,
          customerId: request.workspace.customerId,
          query: request.query,
          timespan: request.timespan,
          timeoutSeconds: request.timeoutSeconds,
          requestId: request.requestId,
          signal: request.signal,
          clientGraceMs: 200,
        }),
    },
    scheduler: new Scheduler({
      perPrincipal: () => options.perPrincipal ?? 4,
      total: () => 16,
      bucketCapacity: 150,
      bucketWindowMs: 30_000,
    }),
    store,
    audit,
    settings: () => ({
      timeoutSeconds: 30,
      failFastOnSemanticError: true,
      fallbackAccessPaths: true,
      ...options.settings,
    }),
    demo: false,
    onChange: (snapshot) => snapshots.push(snapshot),
    random: () => 0, // no backoff delay in tests
    emitIntervalMs: 5,
  });
  return { engine, store, audit, getToken, snapshots, fake };
}

async function finished(
  engine: QueryEngine,
  runId: string,
  timeoutMs = 5000,
): Promise<RunSnapshot> {
  const start = Date.now();
  for (;;) {
    const snapshot = engine.get(runId);
    if (snapshot !== undefined && snapshot.state !== 'running') return snapshot;
    if (Date.now() - start > timeoutMs) throw new Error('run did not finish');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const run = (engine: QueryEngine, workspaces: Workspace[], query = 'Heartbeat | take 2') =>
  engine.run({
    tabId: 'tab-1',
    query,
    timespan: 'P1D',
    resourceIds: workspaces.map((w) => w.resourceId),
  });

describe('QueryEngine against the fake Log Analytics server', () => {
  it('fans out, merges with attribution columns and records the request headers', async () => {
    const [w1, w2] = [
      workspace(1),
      workspace(2, { tenant: TENANT_B, paths: [path_('acct-a', TENANT_B)] }),
    ];
    const {
      engine,
      store,
      fake: server,
    } = await setup({
      workspaces: [w1, w2],
      la: { [w1.customerId]: la(), [w2.customerId]: la() },
    });
    const started = await run(engine, [w1, w2]);
    const result = await finished(engine, started.runId);

    expect(result.state).toBe('completed');
    expect(result.workspaces.map((w) => [w.state, w.rows, w.attempts])).toEqual([
      ['succeeded', 2, 1],
      ['succeeded', 2, 1],
    ]);
    expect(result.workspaces[0]?.statistics?.cpuMs).toBe(16);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.rowCount).toBe(4);

    const page = await store.page(started.runId, 0, 0, 10);
    expect(page.columns.map((c) => c.name)).toEqual([
      '_TenantName',
      '_TenantId',
      '_SubscriptionName',
      '_WorkspaceName',
      '_WorkspaceId',
      '_Account',
      'TimeGenerated',
      'Computer',
    ]);
    expect(page.rows.map((r) => [r[0], r[3], r[7]]).sort()).toEqual([
      ['Contoso', 'la-1', 'ws-001'],
      ['Contoso', 'la-1', 'ws-002'],
      ['Fabrikam', 'la-2', 'ws-001'],
      ['Fabrikam', 'la-2', 'ws-002'],
    ]);

    const request = server.requests.find((r) => r.path.endsWith('/query'));
    expect(request?.headers['prefer']).toBe(
      'wait=30, include-render=true, include-statistics=true',
    );
    expect(request?.headers['x-ms-app']).toBe('RamlKQL/0.0.0-test');
    expect(request?.headers['x-ms-client-request-id']).toMatch(
      new RegExp(`^${started.runId}-\\d+$`),
    );
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      query: 'Heartbeat | take 2',
      timespan: 'P1D',
    });
  });

  it('retries after 429 honouring Retry-After', async () => {
    const w1 = workspace(1);
    const { engine } = await setup({
      workspaces: [w1],
      la: {
        [w1.customerId]: la({
          faults: [{ status: 429, headers: { 'x-ms-retry-after-ms': '50' } }],
        }),
      },
    });
    const started = Date.now();
    const result = await finished(engine, (await run(engine, [w1])).runId);
    expect(result.workspaces[0]).toMatchObject({ state: 'succeeded', attempts: 2, rows: 2 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('retries 5xx up to three attempts', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine } = await setup({
      workspaces: [w1, w2],
      la: {
        [w1.customerId]: la({ faults: [{ status: 503 }, { status: 500 }] }),
        [w2.customerId]: la({ faults: [{ status: 503 }, { status: 503 }, { status: 503 }] }),
      },
    });
    const result = await finished(engine, (await run(engine, [w1, w2])).runId);
    expect(result.workspaces.map((w) => [w.state, w.attempts, w.errorCode])).toEqual([
      ['succeeded', 3, undefined],
      ['failed', 3, 'SERVER_ERROR'],
    ]);
  });

  it('marks server and client timeouts as timeout without retrying', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine } = await setup({
      workspaces: [w1, w2],
      settings: { timeoutSeconds: 1 },
      la: {
        [w1.customerId]: la({
          faults: [{ status: 504, error: { code: 'GatewayTimeout', message: 'Query timed out' } }],
        }),
        [w2.customerId]: la({ delayMs: 2000 }),
      },
    });
    const result = await finished(engine, (await run(engine, [w1, w2])).runId);
    expect(result.workspaces.map((w) => [w.state, w.attempts, w.errorCode])).toEqual([
      ['timeout', 1, 'TIMEOUT'],
      ['timeout', 1, 'TIMEOUT'],
    ]);
    expect(result.workspaces[0]?.message).toBe('GatewayTimeout: Query timed out');
  });

  it('keeps rows of a partial result and shows the server error', async () => {
    const w1 = workspace(1);
    const { engine } = await setup({
      workspaces: [w1],
      la: {
        [w1.customerId]: la({
          partialError: {
            code: 'E_QUERY_RESULT_SET_TOO_LARGE',
            message: 'Query result set has exceeded the internal record count limit',
          },
        }),
      },
    });
    const result = await finished(engine, (await run(engine, [w1])).runId);
    expect(result.workspaces[0]).toMatchObject({
      state: 'partial',
      rows: 2,
      errorCode: 'PARTIAL',
      message:
        'E_QUERY_RESULT_SET_TOO_LARGE: Query result set has exceeded the internal record count limit',
    });
  });

  it('cancels in-flight and queued workspaces and keeps finished results', async () => {
    const [w1, w2, w3] = [workspace(1), workspace(2), workspace(3)];
    const { engine, store } = await setup({
      workspaces: [w1, w2, w3],
      perPrincipal: 2,
      la: {
        [w1.customerId]: la(),
        [w2.customerId]: la({ delayMs: 3000 }),
        [w3.customerId]: la(),
      },
    });
    const started = await run(engine, [w1, w2, w3]);
    // w1 finishes; w2 hangs; w3 waits for w1's slot and then runs quickly.
    await new Promise((resolve) => setTimeout(resolve, 300));
    engine.cancel(started.runId);
    const result = await finished(engine, started.runId);
    expect(result.state).toBe('cancelled');
    const states = Object.fromEntries(result.workspaces.map((w) => [w.resourceId, w.state]));
    expect(states[w1.resourceId]).toBe('succeeded');
    expect(states[w2.resourceId]).toBe('cancelled');
    expect((await store.page(started.runId, 0, 0, 100)).rows.length).toBeGreaterThanOrEqual(2);
  });

  it('drops queued workspaces when cancelled before they start', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine, fake: server } = await setup({
      workspaces: [w1, w2],
      perPrincipal: 1,
      la: { [w1.customerId]: la({ delayMs: 3000 }), [w2.customerId]: la() },
    });
    const started = await run(engine, [w1, w2]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    engine.cancel(started.runId);
    const result = await finished(engine, started.runId);
    expect(result.workspaces.map((w) => w.state)).toEqual(['cancelled', 'cancelled']);
    expect(server.requests.filter((r) => r.path.includes(w2.customerId))).toHaveLength(0);
  });

  it('truncates at the merged row cap', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine, store } = await setup({
      workspaces: [w1, w2],
      perPrincipal: 1,
      maxMergedRows: 3,
      la: { [w1.customerId]: la(), [w2.customerId]: la() },
    });
    const started = await run(engine, [w1, w2]);
    const result = await finished(engine, started.runId);
    expect(result.truncated).toBe(true);
    expect(result.tables[0]?.rowCount).toBe(3);
    expect(result.workspaces.map((w) => [w.state, w.rows])).toEqual([
      ['succeeded', 2],
      ['partial', 1],
    ]);
    expect(result.workspaces[1]?.errorCode).toBe('TRUNCATED');
    expect((await store.page(started.runId, 0, 0, 10)).rows).toHaveLength(3);
  });

  it('falls back to the next access path on 403 and refreshes the token once on 401', async () => {
    const w1 = workspace(1, { paths: [path_('acct-b'), path_('acct-a')] });
    const w2 = workspace(2, { paths: [path_('acct-c')] });
    const { engine, getToken } = await setup({
      workspaces: [w1, w2],
      la: {
        [w1.customerId]: la(), // acct-b's token is not allowed there: 403
        [w2.customerId]: la({ tokens: ['fresh'] }),
      },
      getToken: (request) =>
        Promise.resolve({
          token:
            request.accountId === 'acct-c'
              ? request.forceRefresh === true
                ? 'fresh'
                : 'expired'
              : `token-${request.accountId}`,
          expiresOn: new Date(Date.now() + 3_600_000),
        }),
    });
    const result = await finished(engine, (await run(engine, [w1, w2])).runId);
    const byId = Object.fromEntries(result.workspaces.map((w) => [w.resourceId, w]));
    expect(byId[w1.resourceId]).toMatchObject({
      state: 'succeeded',
      accountId: 'acct-a',
      attempts: 2,
    });
    expect(byId[w2.resourceId]).toMatchObject({ state: 'succeeded', attempts: 2 });
    expect(
      getToken.mock.calls
        .filter(([request]) => request.forceRefresh === true)
        .map(([r]) => r.accountId),
    ).toEqual(['acct-c']);
  });

  it('asks for sign-in when a refreshed token is still rejected', async () => {
    const w1 = workspace(1, { paths: [path_('acct-c')] });
    const { engine } = await setup({
      workspaces: [w1],
      la: { [w1.customerId]: la() },
      getToken: () =>
        Promise.resolve({ token: 'expired', expiresOn: new Date(Date.now() + 3_600_000) }),
    });
    const result = await finished(engine, (await run(engine, [w1])).runId);
    expect(result.workspaces[0]).toMatchObject({
      state: 'failed',
      errorCode: 'AUTH_INTERACTION_REQUIRED',
      attempts: 2,
    });
  });

  it('fails fast on a semantic error from the first workspace, then runs the rest on request', async () => {
    const [w1, w2, w3] = [workspace(1), workspace(2), workspace(3)];
    const semantic = {
      status: 400,
      error: {
        code: 'SemanticError',
        message: "'summarize' operator: Failed to resolve aggregate function 'countt'",
      },
    };
    const { engine, fake: server } = await setup({
      workspaces: [w1, w2, w3],
      perPrincipal: 1,
      la: {
        [w1.customerId]: la({ faults: [semantic] }),
        [w2.customerId]: la(),
        [w3.customerId]: la(),
      },
    });
    const started = await run(engine, [w1, w2, w3]);
    const result = await finished(engine, started.runId);
    expect(result.failFast?.message).toContain('countt');
    expect(result.workspaces.map((w) => [w.state, w.errorCode])).toEqual([
      ['failed', 'QUERY_ERROR'],
      ['skipped', 'FAIL_FAST'],
      ['skipped', 'FAIL_FAST'],
    ]);
    expect(server.requests.filter((r) => r.path.endsWith('/query'))).toHaveLength(1);

    await engine.rerun({ runId: started.runId, states: ['skipped'] });
    const resumed = await finished(engine, started.runId);
    expect(resumed.failFast).toBeUndefined();
    expect(resumed.workspaces.map((w) => w.state)).toEqual(['failed', 'succeeded', 'succeeded']);
  });

  it('does not fail fast when a table is missing in one workspace', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine } = await setup({
      workspaces: [w1, w2],
      perPrincipal: 1,
      la: {
        [w1.customerId]: la({
          faults: [
            {
              status: 400,
              error: {
                code: 'SemanticError',
                message:
                  "'where' operator: Failed to resolve table or column expression named 'DeviceEvents'",
              },
            },
          ],
        }),
        [w2.customerId]: la(),
      },
    });
    const result = await finished(engine, (await run(engine, [w1, w2])).runId);
    expect(result.failFast).toBeUndefined();
    expect(result.workspaces.map((w) => w.state)).toEqual(['failed', 'succeeded']);
  });

  it('re-runs failed workspaces, replacing their rows', async () => {
    const [w1, w2] = [workspace(1), workspace(2)];
    const { engine, store } = await setup({
      workspaces: [w1, w2],
      la: {
        [w1.customerId]: la(),
        [w2.customerId]: la({ faults: [{ status: 503 }, { status: 503 }, { status: 503 }] }),
      },
    });
    const started = await run(engine, [w1, w2]);
    expect((await finished(engine, started.runId)).workspaces[1]?.state).toBe('failed');
    await engine.rerun({ runId: started.runId, states: ['failed'] });
    const result = await finished(engine, started.runId);
    expect(result.workspaces.map((w) => w.state)).toEqual(['succeeded', 'succeeded']);
    expect((await store.page(started.runId, 0, 0, 10)).rows).toHaveLength(4);
  });

  it('skips the other workspaces of a tenant whose token needs sign-in', async () => {
    const [w1, w2, w3] = [
      workspace(1),
      workspace(2),
      workspace(3, { tenant: TENANT_B, paths: [path_('acct-a', TENANT_B)] }),
    ];
    const { engine, getToken } = await setup({
      workspaces: [w1, w2, w3],
      perPrincipal: 1,
      la: { [w1.customerId]: la(), [w2.customerId]: la(), [w3.customerId]: la() },
      getToken: (request) =>
        request.tenantId === TENANT_A
          ? Promise.reject(
              new AppError({
                code: 'AUTH_INTERACTION_REQUIRED',
                message: 'Sign in again to Contoso.',
                retryable: false,
                source: 'main',
              }),
            )
          : Promise.resolve({ token: 'token-acct-a', expiresOn: new Date(Date.now() + 3_600_000) }),
    });
    const result = await finished(engine, (await run(engine, [w1, w2, w3])).runId);
    const byId = Object.fromEntries(result.workspaces.map((w) => [w.resourceId, w]));
    expect(byId[w1.resourceId]).toMatchObject({
      state: 'failed',
      errorCode: 'AUTH_INTERACTION_REQUIRED',
    });
    expect(byId[w2.resourceId]).toMatchObject({
      state: 'skipped',
      errorCode: 'AUTH_INTERACTION_REQUIRED',
    });
    expect(byId[w3.resourceId]).toMatchObject({ state: 'succeeded' });
    expect(getToken.mock.calls.filter(([r]) => r.tenantId === TENANT_A)).toHaveLength(1);
  });

  it('audits every attempt in a verifiable log and frees results of earlier runs of the tab', async () => {
    const w1 = workspace(1);
    const { engine, audit, store } = await setup({
      workspaces: [w1],
      la: { [w1.customerId]: la({ faults: [{ status: 503 }] }) },
    });
    const first = await run(engine, [w1]);
    await finished(engine, first.runId);
    const second = await run(engine, [w1]);
    await finished(engine, second.runId);
    expect(engine.get(first.runId)).toBeUndefined();
    expect(store.tables(first.runId)).toEqual([]);
    await vi.waitFor(async () => {
      expect((await audit.verify()).entries).toBe(3);
    });
    expect(await audit.verify()).toMatchObject({ ok: true, entries: 3 });
  });

  it('reports unknown workspaces as failed', async () => {
    const { engine } = await setup({ workspaces: [], la: {} });
    const result = await finished(
      engine,
      (await engine.run({ tabId: 't', query: 'T', resourceIds: ['/nope'] })).runId,
    );
    expect(result.workspaces[0]).toMatchObject({ state: 'failed', errorCode: 'WORKSPACE_UNKNOWN' });
  });
});

describe('engine helpers', () => {
  it('interleaves tenants round-robin', () => {
    const tenant: Record<string, string> = { a1: 'A', a2: 'A', a3: 'A', b1: 'B', c1: 'C', c2: 'C' };
    expect(
      roundRobinByTenant(['a1', 'a2', 'a3', 'b1', 'c1', 'c2'], (id) => tenant[id] ?? ''),
    ).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });

  it('picks the render spec most workspaces agree on', () => {
    const chart = { visualization: 'timechart' };
    const bars = { visualization: 'barchart' };
    expect(mostCommonRender([undefined, bars, chart, chart])).toEqual(chart);
    expect(mostCommonRender([undefined])).toBeUndefined();
  });
});
