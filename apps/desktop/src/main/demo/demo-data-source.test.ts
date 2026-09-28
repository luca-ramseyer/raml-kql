import { describe, expect, it } from 'vitest';

import type { Workspace } from '../../shared/workspaces/models';

import { ALL_DEMO_TABLES, DemoDataSource, planDemoQuery } from './demo-data-source';
import { DEMO_WORKSPACES, demoResourceId } from './demo-inventory';

function workspaceNamed(name: string): Workspace {
  const demo = DEMO_WORKSPACES.find((w) => w.name === name);
  if (demo === undefined) throw new Error(name);
  return { resourceId: demoResourceId(demo), name } as Workspace;
}

const run = (source: DemoDataSource, name: string, query: string) =>
  source.execute({ workspace: workspaceNamed(name), query, signal: new AbortController().signal });

describe('planDemoQuery', () => {
  it('finds the table, limits and count, ignoring comments and strings', () => {
    expect(
      planDemoQuery('// Heartbeat\nSigninLogs | where x == "Heartbeat" | take 5', ALL_DEMO_TABLES),
    ).toEqual({
      table: 'SigninLogs',
      limit: 5,
      count: false,
      signInSummary: false,
    });
    expect(planDemoQuery('Heartbeat | count', ALL_DEMO_TABLES)).toMatchObject({
      table: 'Heartbeat',
      count: true,
    });
    expect(planDemoQuery('print 1', ALL_DEMO_TABLES).table).toBeUndefined();
  });
});

describe('DemoDataSource', () => {
  it('returns deterministic samples that honour take and use TimeGenerated', async () => {
    const source = new DemoDataSource(() => Date.parse('2026-09-25T12:00:00Z'));
    const first = await run(source, 'la-contoso-soc', 'SecurityEvent | take 7');
    const again = await run(source, 'la-contoso-soc', 'SecurityEvent | take 7');
    expect(first.tables[0]?.rows).toHaveLength(7);
    expect(first.tables[0]?.rows).toEqual(again.tables[0]?.rows);
    expect(first.tables[0]?.columns[0]).toEqual({ name: 'TimeGenerated', type: 'datetime' });
    const computers = first.tables[0]?.rows.map((r) => r[1]);
    expect(computers?.every((c) => typeof c === 'string' && c.endsWith('.contoso.example'))).toBe(
      true,
    );
  });

  it('answers the sample query and count', async () => {
    const source = new DemoDataSource();
    const summary = await run(
      source,
      'la-fabrikam-sentinel',
      'SigninLogs\n| where TimeGenerated > ago(1d)\n| summarize SignIns = count(), FailedSignIns = countif(ResultType != "0") by UserPrincipalName\n| top 20 by FailedSignIns',
    );
    expect(summary.tables[0]?.columns.map((c) => c.name)).toEqual([
      'UserPrincipalName',
      'SignIns',
      'FailedSignIns',
    ]);
    expect(String(summary.tables[0]?.rows[0]?.[0])).toMatch(/@fabrikam\.example$/);
    const count = await run(source, 'la-fabrikam-sentinel', 'Heartbeat | count');
    expect(count.tables[0]?.columns).toEqual([{ name: 'Count', type: 'long' }]);
  });

  it('fails like real workspaces do', async () => {
    const unknownTable: unknown = expect.stringContaining(
      "Failed to resolve table or column expression named 'SigninLogs'",
    );
    const source = new DemoDataSource();
    await expect(run(source, 'la-tailspin-sentinel', 'Heartbeat')).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(run(source, 'la-contoso-apps', 'SigninLogs')).rejects.toMatchObject({
      kind: 'badRequest',
      message: unknownTable,
    });
    await expect(run(source, 'la-woodgrove-sentinel', 'Heartbeat')).rejects.toMatchObject({
      kind: 'throttled',
    });
    await expect(run(source, 'la-woodgrove-sentinel', 'Heartbeat')).resolves.toBeDefined(); // only once
    expect((await run(source, 'la-contoso-soc', 'print 1')).tables[0]?.rows[0]?.[0]).toMatch(
      /^Demo data/,
    );
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const pending = new DemoDataSource().execute({
      workspace: workspaceNamed('la-adventureworks-dev'),
      query: 'Heartbeat',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
