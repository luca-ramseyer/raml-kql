import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AuditLog, sha256, type AuditEvent } from './audit-log';

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const QUERY: AuditEvent = {
  kind: 'query',
  runId: 'run-1',
  account: 'analyst@contoso.example',
  via: 'lighthouse',
  tenantId: '00000000-0000-0000-0000-00000000c004',
  workspaceId: '00000000-0000-0000-0000-000000000101',
  workspaceResourceId:
    '/subscriptions/x/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la',
  query: 'SigninLogs | take 10',
  timespan: 'P1D',
  state: 'succeeded',
  rows: 10,
  durationMs: 1200,
  attempt: 1,
};

function log(
  options: {
    now?: () => Date;
    includeQueryText?: boolean;
    enabled?: boolean;
    retention?: number;
  } = {},
) {
  dir ??= mkdtempSync(path.join(tmpdir(), 'rk-audit-'));
  return new AuditLog({
    dir,
    appVersion: '1.2.3',
    enabled: () => options.enabled ?? true,
    includeQueryText: () => options.includeQueryText ?? true,
    retentionMonths: () => options.retention ?? 12,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

const lines = (file: string): string[] =>
  readFileSync(path.join(dir ?? '', file), 'utf8')
    .split('\n')
    .filter((l) => l !== '');

describe('AuditLog', () => {
  it('writes a hash chain that verifies, across months and restarts', async () => {
    let now = new Date('2026-08-31T23:59:00Z');
    const first = log({ now: () => now });
    await first.append(QUERY);
    await first.append({ kind: 'auth', event: 'signIn', account: 'analyst@contoso.example' });
    now = new Date('2026-09-01T00:01:00Z');
    // A new instance (app restart) continues the chain.
    const second = log({ now: () => now });
    await second.append(QUERY);

    expect(readdirSync(dir ?? '').sort()).toEqual(['audit-2026-08.jsonl', 'audit-2026-09.jsonl']);
    const august = lines('audit-2026-08.jsonl');
    const [september] = lines('audit-2026-09.jsonl');
    const entry = JSON.parse(september ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      seq: 3,
      kind: 'query',
      queryHash: sha256('SigninLogs | take 10'),
      query: 'SigninLogs | take 10',
      appVersion: '1.2.3',
      prev: sha256(august[1] ?? ''),
    });
    expect(await second.verify()).toEqual({ ok: true, entries: 3, files: 2 });
  });

  it('detects edited and deleted lines', async () => {
    const audit = log({ now: () => new Date('2026-09-10T00:00:00Z') });
    for (let i = 0; i < 3; i++) await audit.append(QUERY);
    const file = path.join(dir ?? '', 'audit-2026-09.jsonl');
    const original = readFileSync(file, 'utf8');

    writeFileSync(file, original.replace('"rows":10', '"rows":11'));
    expect(await audit.verify()).toMatchObject({
      ok: false,
      problem: { file: 'audit-2026-09.jsonl', line: 2, reason: 'hash chain broken' },
    });

    const [a, , c] = original.split('\n');
    writeFileSync(file, `${a ?? ''}\n${c ?? ''}\n`);
    expect((await audit.verify()).ok).toBe(false);

    writeFileSync(file, `${original}not json\n`);
    expect((await audit.verify()).problem?.reason).toBe('not valid JSON');
  });

  it('stores only the hash when query text is off, and nothing when disabled', async () => {
    const hashed = log({ includeQueryText: false, now: () => new Date('2026-09-10T00:00:00Z') });
    await hashed.append(QUERY);
    const [line] = lines('audit-2026-09.jsonl');
    expect(line).not.toContain('SigninLogs');
    expect(line).toContain(sha256('SigninLogs | take 10'));

    const disabled = log({ enabled: false, now: () => new Date('2026-10-10T00:00:00Z') });
    await disabled.append(QUERY);
    expect(readdirSync(dir ?? '')).toEqual(['audit-2026-09.jsonl']);
  });

  it('prunes months beyond the retention; the oldest kept line anchors verification', async () => {
    let now = new Date('2026-01-15T00:00:00Z');
    const audit = log({ now: () => now, retention: 2 });
    for (const month of ['01', '02', '03']) {
      now = new Date(`2026-${month}-15T00:00:00Z`);
      await audit.append(QUERY);
    }
    await audit.prune();
    expect(readdirSync(dir ?? '').sort()).toEqual(['audit-2026-02.jsonl', 'audit-2026-03.jsonl']);
    expect(await audit.verify()).toEqual({ ok: true, entries: 2, files: 2 });
  });

  it('serializes concurrent appends so the chain never forks', async () => {
    const audit = log({ now: () => new Date('2026-09-10T00:00:00Z') });
    await Promise.all(Array.from({ length: 20 }, () => audit.append(QUERY)));
    expect(await audit.verify()).toEqual({ ok: true, entries: 20, files: 1 });
  });
});
