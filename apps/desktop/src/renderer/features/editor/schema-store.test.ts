import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { MergedSchema } from '../../../shared/schema/models';
import { useNotifications } from '../../platform/notifications';
import { applySettingsSnapshot } from '../../platform/settings';
import { useTargets } from '../targets/targets-store';

import {
  completionSuffix,
  loadSchema,
  markSchemaApplied,
  resetSchemaStore,
  startSchemaSync,
  useSchema,
  whenSchemaSettled,
} from './schema-store';

const MERGED: MergedSchema = {
  loaded: 5,
  failed: 1,
  tables: [
    { name: 'Heartbeat', available: 5, columns: [] },
    { name: 'DeviceProcessEvents', available: 3, columns: [] },
  ],
  functions: [{ name: 'FailedSignIns', parameters: '', body: 'T', available: 1 }],
};

function install(get = vi.fn(() => Promise.resolve(MERGED))) {
  installWorkbenchHarness({ schema: { get } });
  return get;
}

describe('schema store', () => {
  beforeEach(() => {
    resetSchemaStore();
    useTargets.setState({ selected: new Set(['/ws/a', '/ws/b']), initialized: true });
  });
  afterEach(() => {
    resetSchemaStore();
    resetWorkbenchState();
    vi.useRealTimers();
  });

  it('loads the merged schema for the selected targets', async () => {
    const get = install();
    await loadSchema();
    expect(get).toHaveBeenCalledWith({ resourceIds: ['/ws/a', '/ws/b'], refresh: false });
    const state = useSchema.getState();
    expect(state.merged).toEqual(MERGED);
    expect(state.loading).toBe(false);
    expect(state.kusto?.database.tables.map((t) => t.name)).toEqual([
      'Heartbeat',
      'DeviceProcessEvents',
    ]);
  });

  it('gives every rebuilt Kusto schema a higher version', async () => {
    install();
    await loadSchema();
    const first = useSchema.getState().kusto?.database.majorVersion ?? 0;
    await loadSchema();
    expect(useSchema.getState().kusto?.database.majorVersion).toBeGreaterThan(first);
  });

  it('suffixes completions of tables and functions missing somewhere', async () => {
    install();
    expect(completionSuffix('DeviceProcessEvents')).toBeUndefined();
    await loadSchema();
    expect(completionSuffix('DeviceProcessEvents')).toBe('3/5');
    expect(completionSuffix('FailedSignIns')).toBe('1/5');
    expect(completionSuffix('Heartbeat')).toBeUndefined();
    expect(completionSuffix('where')).toBeUndefined();
  });

  it('warns about unreachable workspaces on an explicit refresh', async () => {
    const get = install();
    await loadSchema(true);
    expect(get).toHaveBeenCalledWith({ resourceIds: ['/ws/a', '/ws/b'], refresh: true });
    expect(useNotifications.getState().notifications.map((n) => n.message)).toEqual([
      expect.stringContaining('could not be loaded for 1 of 2 workspaces'),
    ]);
  });

  it('keeps only the newest response when requests overlap', async () => {
    let resolveFirst: (value: MergedSchema) => void = () => undefined;
    const get = vi
      .fn<() => Promise<MergedSchema>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve(MERGED));
    install(get);
    const first = loadSchema();
    await loadSchema();
    resolveFirst({ loaded: 0, failed: 0, tables: [], functions: [] });
    await first;
    expect(useSchema.getState().merged).toEqual(MERGED);
  });

  it('reports errors', async () => {
    install(vi.fn(() => Promise.reject(new Error('boom'))));
    await loadSchema();
    expect(useSchema.getState().loading).toBe(false);
    expect(useNotifications.getState().notifications[0]?.severity).toBe('error');
  });

  it('settles once the schema for the current targets reached the language service', async () => {
    install();
    let settled = false;
    const waiting = whenSchemaSettled(10_000).then(() => {
      settled = true;
    });
    await loadSchema();
    await Promise.resolve();
    expect(settled).toBe(false); // loaded, but not applied yet
    const kusto = useSchema.getState().kusto;
    if (kusto === undefined) throw new Error('no schema');
    markSchemaApplied(kusto);
    await waiting;
    expect(settled).toBe(true);
    await expect(whenSchemaSettled(10_000)).resolves.toBeUndefined();
  });

  it('gives up waiting after the timeout', async () => {
    vi.useFakeTimers();
    install();
    const waiting = whenSchemaSettled(5000);
    vi.advanceTimersByTime(5000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('follows target changes (debounced) and the hide setting', async () => {
    vi.useFakeTimers();
    const get = install();
    startSchemaSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(1);

    useTargets.setState({ selected: new Set(['/ws/a']) });
    useTargets.setState({ selected: new Set(['/ws/b']) });
    await vi.advanceTimersByTimeAsync(300);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith({ resourceIds: ['/ws/b'], refresh: false });

    const tables = () => useSchema.getState().kusto?.database.tables.length ?? 0;
    const before = tables();
    applySettingsSnapshot({
      values: { 'schema.hideTablesMissingEverywhere': false },
      problems: [],
    });
    expect(tables()).toBeGreaterThan(before);
  });
});
