import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { TabsState } from '../../../shared/query/tabs';
import { activateEditor, resetEditors, splitGroup, useEditors } from '../../platform/editors';
import {
  resetTabTargets,
  setSelected,
  startTabTargets,
  tabTargets,
  useTargets,
} from '../targets/targets-store';

import { newQuery, openQueryTab, resetOpenQuery } from './open-query';
import { updateQueryDoc, useQueryDocs } from './query-docs';
import { buildTabsState, restoreTabs, startTabPersistence } from './tab-persistence';

const WS_A = '/subscriptions/00000000-0000-0000-0000-00000000000a/workspaces/contoso';
const WS_B = '/subscriptions/00000000-0000-0000-0000-00000000000b/workspaces/fabrikam';

function activeQueryTab(): string | undefined {
  const { editors, activeId } = useEditors.getState();
  return editors.find((e) => e.id === activeId && e.kind === 'query')?.id;
}

describe('tab persistence', () => {
  let stopTargets: () => void = () => undefined;
  beforeEach(() => {
    resetOpenQuery();
    resetTabTargets();
    useQueryDocs.setState({ docs: {} });
    useTargets.setState({ selected: new Set([WS_A, WS_B]), groupId: undefined, initialized: true });
    stopTargets = startTabTargets(activeQueryTab, (listener) =>
      useEditors.subscribe(() => {
        listener();
      }),
    );
  });
  afterEach(() => {
    stopTargets();
    resetTabTargets();
    resetWorkbenchState();
  });

  it('keeps targets per tab and follows the active tab', () => {
    const first = newQuery();
    setSelected([WS_B], false);
    const second = openQueryTab({ text: 'AuditLogs', targets: { selected: [WS_B], groupId: 'g' } });
    expect([...useTargets.getState().selected]).toEqual([WS_B]);
    expect(useTargets.getState().groupId).toBe('g');
    activateEditor(first);
    expect([...useTargets.getState().selected]).toEqual([WS_A]);
    expect(tabTargets(second)).toEqual({ selected: [WS_B], groupId: 'g' });
  });

  it('saves query text, time range, cursor, targets and groups, and restores them without results', async () => {
    const first = newQuery();
    updateQueryDoc(first, { cursor: { line: 2, column: 3 } });
    setSelected([WS_B], false);
    splitGroup();
    const second = openQueryTab({
      text: 'AuditLogs',
      timeRange: { kind: 'preset', preset: '7d' },
      file: { path: 'audit.kql', savedText: 'AuditLogs | take 1' },
    });
    const state = buildTabsState();
    expect(state.groups).toHaveLength(2);
    expect(state.groups[0]?.editors[0]?.query?.text).toContain('SigninLogs');
    expect(state.groups[0]?.editors[0]?.query).toMatchObject({
      cursor: { line: 2, column: 3 },
      targets: [WS_A],
    });
    expect(state.groups[1]?.editors[0]?.query).toMatchObject({
      text: 'AuditLogs',
      timeRange: { kind: 'preset', preset: '7d' },
      file: { path: 'audit.kql', savedText: 'AuditLogs | take 1' },
    });
    // Nothing about results is ever part of the saved state.
    expect(JSON.stringify(state)).not.toMatch(/rows|runId/);

    // "Restart": fresh stores, then restore from what was saved.
    stopTargets();
    resetEditors();
    resetTabTargets();
    useQueryDocs.setState({ docs: {} });
    installWorkbenchHarness({
      tabs: { read: vi.fn(() => Promise.resolve(state)), write: vi.fn(() => Promise.resolve()) },
    });
    stopTargets = startTabTargets(activeQueryTab, (listener) =>
      useEditors.subscribe(() => {
        listener();
      }),
    );
    expect(await restoreTabs()).toBe(true);

    const { groups, activeId } = useEditors.getState();
    expect(groups.map((g) => g.editors.map((e) => e.id))).toEqual([[first], [second]]);
    expect(activeId).toBe(second);
    // The file-linked tab differs from its file: dirty dot.
    expect(groups[1]?.editors[0]?.dirty).toBe(true);
    expect(useQueryDocs.getState().docs[first]).toMatchObject({
      cursor: { line: 2, column: 3 },
      restored: true,
    });
    activateEditor(first);
    expect([...useTargets.getState().selected]).toEqual([WS_A]);
    // Restored tabs mean the sample query isn't offered again.
    const added = newQuery();
    expect(useQueryDocs.getState().docs[added]?.text).toBe('');
  });

  it('starts empty when nothing (or nothing valid) was saved', async () => {
    const empty: TabsState = {
      version: 1,
      queryCounter: 0,
      activeGroupId: 'group-1',
      groups: [{ id: 'group-1', size: 1, editors: [] }],
    };
    installWorkbenchHarness({
      tabs: { read: vi.fn(() => Promise.resolve(empty)), write: vi.fn(() => Promise.resolve()) },
    });
    expect(await restoreTabs()).toBe(false);
    expect(useEditors.getState().editors).toEqual([]);
  });

  it('saves changes debounced and once more on dispose', async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(() => Promise.resolve());
      installWorkbenchHarness({ tabs: { read: vi.fn(() => Promise.resolve(undefined)), write } });
      const stop = startTabPersistence();
      const id = newQuery();
      updateQueryDoc(id, { text: 'Heartbeat' });
      expect(write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600);
      expect(write).toHaveBeenCalledTimes(1);
      updateQueryDoc(id, { text: 'Heartbeat | take 1' });
      stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
