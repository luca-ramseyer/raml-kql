import type { TabsState } from '../../../shared/query/tabs';
import {
  editorsSnapshot,
  restoreEditors,
  updateEditor,
  useEditors,
  type EditorInput,
} from '../../platform/editors';
import { getBridge, unwrap } from '../../services/ipc';
import { setTabTargets, tabTargets, useTargets } from '../targets/targets-store';

import { markStarterShown } from './open-query';
import { createQueryDoc, isDirty, useQueryDocs } from './query-docs';

/**
 * Tabs survive restarts (spec 05, "Persistence"): editors, groups, query text, time range,
 * cursor, targets and linked files are saved to `state/tabs.json` (debounced 500 ms, and when
 * the window closes). Results are never saved; restored tabs say so (spec 04).
 */
const SAVE_DELAY_MS = 500;

type PersistedInput = EditorInput & { kind: Exclude<EditorInput['kind'], 'packUpdate'> };

function isPersisted(editor: EditorInput): editor is PersistedInput {
  return editor.kind !== 'packUpdate';
}

export function buildTabsState(): TabsState {
  const snapshot = editorsSnapshot();
  const { docs } = useQueryDocs.getState();
  return {
    version: 1,
    queryCounter: snapshot.queryCounter,
    activeGroupId: snapshot.activeGroupId,
    groups: snapshot.groups.map((group) => ({
      id: group.id,
      size: group.size,
      ...(group.activeId === undefined ||
      !group.editors.some((e) => e.id === group.activeId && e.kind !== 'packUpdate')
        ? {}
        : { activeId: group.activeId }),
      // Reviews of pack updates are not restored: they would be stale.
      editors: group.editors.filter(isPersisted).map((editor) => {
        const doc = editor.kind === 'query' ? docs[editor.id] : undefined;
        const targets = editor.kind === 'query' ? tabTargets(editor.id) : undefined;
        return {
          id: editor.id,
          kind: editor.kind,
          title: editor.title,
          ...(editor.pinned === true ? { pinned: true } : {}),
          ...(editor.description === undefined ? {} : { description: editor.description }),
          ...(doc === undefined
            ? {}
            : {
                query: {
                  text: doc.text,
                  timeRange: doc.timeRange,
                  ...(doc.cursor === undefined ? {} : { cursor: doc.cursor }),
                  ...(targets === undefined
                    ? {}
                    : {
                        targets: targets.selected,
                        ...(targets.groupId === undefined
                          ? {}
                          : { targetGroupId: targets.groupId }),
                      }),
                  ...(doc.file === undefined ? {} : { file: doc.file }),
                  ...(doc.parameters === undefined ? {} : { parameters: doc.parameters }),
                },
              }),
        };
      }),
    })),
  };
}

/** Restore the last session's tabs. Returns whether any tab came back. */
export async function restoreTabs(): Promise<boolean> {
  let state: TabsState | null;
  try {
    state = await unwrap(getBridge().tabs.get());
  } catch {
    return false;
  }
  if (state === null || state.groups.every((g) => g.editors.length === 0)) return false;
  let queries = 0;
  for (const group of state.groups) {
    for (const editor of group.editors) {
      if (editor.kind !== 'query') continue;
      const query = editor.query ?? {
        text: '',
        timeRange: { kind: 'preset' as const, preset: '24h' as const },
      };
      queries += 1;
      createQueryDoc(editor.id, query.text, {
        timeRange: query.timeRange,
        cursor: query.cursor,
        file: query.file,
        parameters: query.parameters,
        restored: true,
      });
      if (query.targets !== undefined) setTabTargets(editor.id, query.targets, query.targetGroupId);
    }
  }
  restoreEditors({
    queryCounter: state.queryCounter,
    activeGroupId: state.activeGroupId,
    groups: state.groups.map((g) => ({
      id: g.id,
      size: g.size,
      activeId: g.activeId,
      editors: g.editors.map((e): EditorInput => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        icon:
          e.kind === 'query'
            ? 'file-code'
            : e.kind === 'welcome'
              ? 'home'
              : e.kind === 'settings'
                ? 'settings'
                : 'server',
        ...(e.pinned === true ? { pinned: true } : {}),
        ...(e.description === undefined ? {} : { description: e.description }),
        ...(e.query !== undefined &&
        isDirty({
          text: e.query.text,
          file: e.query.file,
          timeRange: e.query.timeRange,
          timeSetInQuery: false,
        })
          ? { dirty: true }
          : {}),
      })),
    })),
  });
  if (queries > 0) markStarterShown();
  return true;
}

/** Save tabs whenever they change (debounced) and when the window closes. */
export function startTabPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  const save = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const state = buildTabsState();
    const text = JSON.stringify(state);
    if (text === last) return;
    last = text;
    try {
      void unwrap(getBridge().tabs.set(state)).catch(() => {
        last = '';
      });
    } catch {
      // No bridge any more (window closing, tests): nothing to save to.
      last = '';
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  // Keep the dirty dot in step with the text (linked My Queries files).
  const syncDirty = (): void => {
    const { docs } = useQueryDocs.getState();
    for (const editor of useEditors.getState().editors) {
      if (editor.kind !== 'query') continue;
      const dirty = isDirty(docs[editor.id]);
      if ((editor.dirty === true) !== dirty) updateEditor(editor.id, { dirty });
    }
  };
  const unsubscribers = [
    useEditors.subscribe(() => {
      schedule();
    }),
    useQueryDocs.subscribe(() => {
      syncDirty();
      schedule();
    }),
    useTargets.subscribe(() => {
      schedule();
    }),
  ];
  const onUnload = (): void => {
    save();
  };
  window.addEventListener('beforeunload', onUnload);
  return () => {
    window.removeEventListener('beforeunload', onUnload);
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (timer !== undefined) save();
  };
}
