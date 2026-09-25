import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TabsState } from '../../shared/query/tabs';

import { TabsStore } from './tabs-store';

function state(text: string): TabsState {
  return {
    version: 1,
    queryCounter: 2,
    activeGroupId: 'g1',
    groups: [
      {
        id: 'g1',
        size: 1,
        activeId: 'query-1',
        editors: [
          {
            id: 'query-1',
            kind: 'query',
            title: 'Query 1',
            query: { text, timeRange: { kind: 'preset', preset: '24h' } },
          },
        ],
      },
    ],
  };
}

describe('TabsStore', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the file is missing or invalid', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-tabs-'));
    expect(await new TabsStore(path.join(dir, 'state', 'tabs.json')).read()).toBeUndefined();
    writeFileSync(path.join(dir, 'bad.json'), '{ "version": 99 }');
    expect(await new TabsStore(path.join(dir, 'bad.json')).read()).toBeUndefined();
    writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    expect(await new TabsStore(path.join(dir, 'broken.json')).read()).toBeUndefined();
  });

  it('round-trips tabs, creating the state folder with owner-only permissions', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-tabs-'));
    const file = path.join(dir, 'state', 'tabs.json');
    const store = new TabsStore(file);
    await store.write(state('SigninLogs | take 10'));
    expect(await store.read()).toEqual(state('SigninLogs | take 10'));
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('keeps the newest state when writes overlap', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-tabs-'));
    const file = path.join(dir, 'tabs.json');
    const store = new TabsStore(file);
    await Promise.all([store.write(state('a')), store.write(state('b')), store.write(state('c'))]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state('c'));
  });
});
