import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QueryRunRequest, RunSnapshot } from '../../shared/query/models';

import { HistoryService } from './history-service';

const WS_A =
  '/subscriptions/00000000-0000-0000-0000-00000000000a/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/contoso-sec';
const WS_B =
  '/subscriptions/00000000-0000-0000-0000-00000000000b/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/fabrikam-sec';
const TENANTS: Record<string, string> = {
  [WS_A.toLowerCase()]: '00000000-0000-0000-0000-0000000000a1',
  [WS_B.toLowerCase()]: '00000000-0000-0000-0000-0000000000b1',
};

function request(query: string): QueryRunRequest {
  return {
    tabId: 'query-1',
    query,
    resourceIds: [WS_A, WS_B],
    groupId: 'group-1',
    timeRange: { kind: 'preset', preset: '24h' },
    tabTitle: 'Sign-ins',
  };
}

function snapshot(runId: string, state: RunSnapshot['state'], finished = true): RunSnapshot {
  return {
    runId,
    tabId: 'query-1',
    state,
    query: 'SigninLogs',
    startedAt: '2026-01-01T10:00:00.000Z',
    ...(finished ? { finishedAt: '2026-01-01T10:00:02.500Z' } : {}),
    timespan: 'P1D',
    workspaces: [
      { resourceId: WS_A, tenantId: 'x', state: 'succeeded', rows: 10, attempts: 1 },
      { resourceId: WS_B, tenantId: 'y', state: 'failed', rows: 0, attempts: 3 },
    ],
    tables: [],
    truncated: false,
    demo: true,
  };
}

async function flush(service: HistoryService): Promise<void> {
  // Appends are queued; list() waits for the load, one tick is enough for the write.
  await vi.waitFor(async () => {
    expect((await service.list()).length).toBeGreaterThan(0);
  });
}

describe('HistoryService', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  function create(maxEntries = 100): {
    service: HistoryService;
    file: string;
    onChange: () => void;
  } {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-history-'));
    const file = path.join(dir, 'state', 'history.jsonl');
    const onChange = vi.fn();
    const service = new HistoryService({
      file,
      maxEntries: () => maxEntries,
      tenantOf: (id) => TENANTS[id],
      onChange,
    });
    return { service, file, onChange };
  }

  it('records a finished run once, with counts, tenants and what was asked for', async () => {
    const { service, file, onChange } = create();
    service.started('run-1', request('SigninLogs | take 10'));
    service.observe(snapshot('run-1', 'running', false));
    expect(await service.list()).toEqual([]);
    service.observe(snapshot('run-1', 'completed'));
    service.observe(snapshot('run-1', 'completed')); // a re-run of failed workspaces
    await flush(service);
    const entries = await service.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'run-1',
      query: 'SigninLogs | take 10',
      targets: [WS_A.toLowerCase(), WS_B.toLowerCase()],
      tenantIds: Object.values(TENANTS),
      groupId: 'group-1',
      timeRange: { kind: 'preset', preset: '24h' },
      timespan: 'P1D',
      tabTitle: 'Sign-ins',
      rows: 10,
      durationMs: 2500,
    });
    expect(entries[0]?.counts).toMatchObject({ succeeded: 1, failed: 1 });
    expect(onChange).toHaveBeenCalled();
    // Query text and targets only: no result data in the file.
    expect(readFileSync(file, 'utf8')).not.toContain('rows":[');
  });

  it('ignores runs it was not told about', async () => {
    const { service } = create();
    service.observe(snapshot('unknown', 'completed'));
    expect(await service.list()).toEqual([]);
  });

  it('lists newest first, capped, and skips damaged lines', async () => {
    const { service, file } = create(3);
    for (let i = 1; i <= 5; i++) {
      service.started(`run-${String(i)}`, request(`Q${String(i)}`));
      service.observe(snapshot(`run-${String(i)}`, 'completed'));
    }
    await vi.waitFor(async () => {
      expect((await service.list()).map((e) => e.query)).toEqual(['Q5', 'Q4', 'Q3']);
    });
    appendFileSync(file, '{"half": \n');
    const reread = new HistoryService({
      file,
      maxEntries: () => 3,
      tenantOf: () => undefined,
      onChange: () => undefined,
    });
    expect((await reread.list()).map((e) => e.query)).toEqual(['Q5', 'Q4', 'Q3']);
  });

  it('clears the history', async () => {
    const { service, onChange } = create();
    service.started('run-1', request('Q'));
    service.observe(snapshot('run-1', 'completed'));
    await flush(service);
    await service.clear();
    expect(await service.list()).toEqual([]);
    expect(onChange).toHaveBeenCalled();
  });
});
