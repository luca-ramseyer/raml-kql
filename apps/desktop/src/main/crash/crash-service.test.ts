import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CrashService } from './crash-service';
import { CrashStore } from './crash-store';
import { parseDsn, SentrySink } from './sentry-sink';

const env = { appVersion: '0.9.0', electronVersion: '44.4.5', os: 'darwin 25.0.0 arm64' };

describe('CrashService', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function create(
    mode: 'ask' | 'off' | 'auto' = 'ask',
    sink?: { send: (record: unknown) => Promise<void> },
  ) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-crash-'));
    dirs.push(dir);
    const store = new CrashStore(dir);
    const service = new CrashService({
      store,
      env,
      sanitizeOptions: () => ({ homeDir: '/Users/analyst', names: ['Fabrikam Holdings'] }),
      mode: () => mode,
      sink,
    });
    return { dir, store, service };
  }

  it('writes only sanitized records, and offers them on the next start', async () => {
    const { dir, store, service } = create();
    await service.start();
    await service.capture(
      'main',
      new Error(
        'Query for Fabrikam Holdings failed: alice@fabrikam.com tenant 00000000-0000-0000-0000-000000000001',
      ),
    );
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    expect(onDisk).not.toMatch(
      /Fabrikam Holdings|alice@|00000000-0000-0000-0000-000000000001|\/Users\/analyst/,
    );

    // Next start: the session marker shows the app didn't end normally.
    const next = new CrashService({ store, env, sanitizeOptions: () => ({}), mode: () => 'ask' });
    await next.start();
    const pending = await next.pending();
    expect(pending.unclean).toBe(true);
    expect(pending.records).toHaveLength(1);
    const report = await next.report();
    expect(report.title).toContain('Crash: Error: Query for <name> failed');
    expect(report.body).toContain('- Raml KQL: 0.9.0');
    expect(report.body).not.toContain('alice@');
    const url = next.issueUrl({ ...report, body: `${report.body}\nuser note bob@contoso.com` });
    expect(url.startsWith('https://github.com/luca-ramseyer/raml-kql/issues/new?')).toBe(true);
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).not.toContain('bob@contoso.com');

    await next.dismiss();
    expect((await next.pending()).records).toEqual([]);
  });

  it('does not prompt after a clean exit with only a few minor errors', async () => {
    const { store, service } = create();
    await service.start();
    await service.capture('renderer', new Error('ResizeObserver loop'));
    service.end();
    const next = new CrashService({ store, env, sanitizeOptions: () => ({}), mode: () => 'ask' });
    await next.start();
    expect(await next.pending()).toEqual({ unclean: false, records: [] });
  });

  it('never prompts when off, and sends to the sink only in auto mode', async () => {
    const off = create('off');
    await off.service.start();
    await off.service.capture('main', new Error('x'));
    expect((await off.service.pending()).records).toEqual([]);

    const send = vi.fn(() => Promise.resolve());
    const auto = create('auto', { send });
    await auto.service.capture('main', new Error('boom at 203.0.113.9'));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: 'Error: boom at <ip>' }));
  });

  it('shortens very long issue URLs', () => {
    const { service } = create();
    const url = service.issueUrl({ title: 'Crash', body: 'x'.repeat(50_000) });
    expect(url.length).toBeLessThanOrEqual(7500);
  });
});

describe('SentrySink', () => {
  it('parses DSNs and posts an envelope with the sanitized record only', async () => {
    expect(parseDsn('https://abc123@o1.ingest.example.io/42')).toEqual({
      key: 'abc123',
      envelopeUrl: 'https://o1.ingest.example.io/api/42/envelope/',
    });
    expect(parseDsn('http://abc@host/42')).toBeUndefined();
    expect(parseDsn('nonsense')).toBeUndefined();
    const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('')));
    const dsn = parseDsn('https://abc123@o1.ingest.example.io/42');
    if (dsn === undefined) throw new Error('dsn');
    await new SentrySink(dsn, fetch).send({
      id: 'x',
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'main',
      message: 'TypeError: boom',
      appVersion: '0.9.0',
      electronVersion: '44',
      os: 'linux',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://o1.ingest.example.io/api/42/envelope/');
    const body = typeof init?.body === 'string' ? init.body : '';
    expect(body).toContain('"type":"TypeError"');
    expect(body).not.toMatch(/"user"|breadcrumbs|server_name/);
  });
});
