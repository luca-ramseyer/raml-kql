import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogService } from './catalog-service';

const URL_A = 'https://catalog.example/a.json';
const URL_B = 'https://catalog.example/b.json';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: id,
  publisher: id.split('.')[0],
  description: `The ${id} extension.`,
  categories: [],
  package: `https://github.com/example/${id}/releases/latest/download/x.rkqlx`,
  ...extra,
});
const catalogJson = (...entries: unknown[]) =>
  JSON.stringify({ schemaVersion: 1, name: 'Test catalog', extensions: entries });
const ok = (body: string) => Promise.resolve(new Response(body, { status: 200 }));

describe('CatalogService', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function create(
    fetch: (url: string) => Promise<Response>,
    options: { urls?: string[]; enabled?: boolean; demo?: boolean; now?: () => Date } = {},
  ) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-catalog-'));
    dirs.push(dir);
    const cacheFile = path.join(dir, 'state', 'extension-catalog.json');
    const fetchSpy = vi.fn(fetch);
    const service = new CatalogService({
      fetch: fetchSpy,
      cacheFile,
      urls: () => options.urls ?? [URL_A],
      enabled: () => options.enabled ?? true,
      demo: options.demo ?? false,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return { service, fetchSpy, cacheFile };
  }

  it('fetches on the first load, saves the list, and uses it while it is fresh', async () => {
    let now = new Date('2026-10-07T10:00:00Z');
    const { service, fetchSpy, cacheFile } = create(
      () => ok(catalogJson(entry('raml.one'), entry('raml.two'))),
      { now: () => now },
    );
    const first = await service.load(false);
    expect(first.entries.map((e) => e.id)).toEqual(['raml.one', 'raml.two']);
    expect(first.fromCache).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(readFileSync(cacheFile, 'utf8')).toContain('raml.one');

    now = new Date('2026-10-07T12:00:00Z');
    const second = await service.load(false);
    expect(second.fromCache).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Still fresh: no request.

    expect((await service.load(true)).fromCache).toBe(false); // Refresh always asks.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    now = new Date('2026-10-09T12:00:00Z'); // Older than a day.
    await service.load(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('shows the saved list when the network fails, and an error when there is none', async () => {
    const { service } = create(() => Promise.reject(new Error('offline')));
    const nothing = await service.load(true);
    expect(nothing.entries).toEqual([]);
    expect(nothing.error).toContain('could not be loaded');
    expect(nothing.problems[0]).toContain('catalog.example');

    let online = true;
    const { service: saved } = create(() =>
      online ? ok(catalogJson(entry('raml.one'))) : Promise.reject(new Error('offline')),
    );
    await saved.load(false);
    online = false;
    const offline = await saved.load(true);
    expect(offline.entries.map((e) => e.id)).toEqual(['raml.one']);
    expect(offline.fromCache).toBe(true);
    expect(offline.error).toBeUndefined();
  });

  it('skips bad entries and reports them, and reads several catalogs with the first winning', async () => {
    const bodies: Record<string, string> = {
      [URL_A]: catalogJson(
        entry('raml.one'),
        { nonsense: true },
        entry('raml.shared', { displayName: 'From A' }),
      ),
      [URL_B]: catalogJson(entry('raml.shared', { displayName: 'From B' }), entry('raml.three')),
    };
    const { service } = create((url) => ok(bodies[url] ?? ''), { urls: [URL_A, URL_B] });
    const result = await service.load(true);
    expect(result.entries.map((e) => e.id)).toEqual(['raml.one', 'raml.shared', 'raml.three']);
    expect(result.entries.find((e) => e.id === 'raml.shared')?.displayName).toBe('From A');
    expect(result.problems).toHaveLength(1);
  });

  it('keeps going when one of two catalogs is down', async () => {
    const { service } = create(
      (url) =>
        url === URL_A ? Promise.reject(new Error('down')) : ok(catalogJson(entry('raml.b'))),
      { urls: [URL_A, URL_B] },
    );
    const result = await service.load(true);
    expect(result.entries.map((e) => e.id)).toEqual(['raml.b']);
    expect(result.error).toBeUndefined();
    expect(result.problems.join(' ')).toContain('down');
  });

  it('rejects non-https catalogs, oversized files, bad JSON and non-catalogs', async () => {
    const insecure = create(() => ok(catalogJson()), { urls: ['http://catalog.example/c.json'] });
    expect((await insecure.service.load(true)).problems[0]).toContain('https');
    expect(insecure.fetchSpy).not.toHaveBeenCalled();

    const huge = create(() => ok('x'.repeat(1024 * 1024 + 1)));
    expect((await huge.service.load(true)).problems[0]).toContain('larger than 1 MB');
    const bad = create(() => ok('<html>'));
    expect((await bad.service.load(true)).problems[0]).toContain('not valid JSON');
    const other = create(() => ok('{"hello":"world"}'));
    expect((await other.service.load(true)).problems[0]).toContain('not an extension catalog');
    const missing = create(() => Promise.resolve(new Response('', { status: 404 })));
    expect((await missing.service.load(true)).problems[0]).toContain('HTTP 404');
  });

  it('does nothing when it is turned off, and uses sample entries in demo mode', async () => {
    const off = create(() => ok(catalogJson(entry('raml.one'))), { enabled: false });
    expect(await off.service.load(true)).toMatchObject({ enabled: false, entries: [] });
    expect(off.fetchSpy).not.toHaveBeenCalled();

    const demo = create(() => ok(catalogJson()), { demo: true });
    const result = await demo.service.load(true);
    expect(result.demo).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(demo.fetchSpy).not.toHaveBeenCalled();
    expect(await demo.service.find('contoso.whois-lookup')).toBeDefined();
  });

  it('finds entries in the saved list without the network, and ignores a damaged cache', async () => {
    const { service, fetchSpy, cacheFile } = create(() => ok(catalogJson(entry('raml.one'))));
    expect(await service.find('raml.one')).toBeUndefined();
    await service.load(true);
    expect((await service.find('raml.one'))?.id).toBe('raml.one');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    writeFileSync(cacheFile, 'not json');
    expect(await service.find('raml.one')).toBeUndefined();
  });

  it('asks again when the configured catalogs changed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-catalog-'));
    dirs.push(dir);
    let urls = [URL_A];
    const fetch = vi.fn(() => ok(catalogJson(entry('raml.one'))));
    const service = new CatalogService({
      fetch,
      cacheFile: path.join(dir, 'c.json'),
      urls: () => urls,
      enabled: () => true,
      demo: false,
    });
    await service.load(false);
    await service.load(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    urls = [URL_A, URL_B];
    await service.load(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
