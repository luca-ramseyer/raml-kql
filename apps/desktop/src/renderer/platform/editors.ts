import { create } from 'zustand';

/**
 * Open editors (tabs) in editor groups (spec 05, "Tabs and editor groups"): groups side by
 * side, each with its own tabs, active tab and MRU order. `editors` and `activeId` are derived
 * (all tabs, and the active group's active tab) for callers that don't care about groups.
 */
/** `packUpdate`: reviewing a query pack update (one per source, not restored on restart). */
export type EditorKind = 'welcome' | 'settings' | 'workspaces' | 'query' | 'packUpdate';

export interface EditorInput {
  id: string;
  kind: EditorKind;
  title: string;
  icon: string;
  /** Pinned tabs stay left and survive "close others". */
  pinned?: boolean | undefined;
  /** A preview tab (italic) is replaced by the next preview opened in its group. */
  preview?: boolean | undefined;
  /** Unsaved changes (dot instead of the close button). */
  dirty?: boolean | undefined;
  /** Shown after the title, dimmed (e.g. a folder). */
  description?: string | undefined;
}

export interface EditorGroup {
  id: string;
  editors: EditorInput[];
  activeId: string | undefined;
  /** Most recently used first (Ctrl+Tab). */
  mru: string[];
  /** Relative width. */
  size: number;
}

interface EditorsState {
  groups: EditorGroup[];
  activeGroupId: string;
  /** Derived: every editor, group by group. */
  editors: EditorInput[];
  /** Derived: the active group's active editor. */
  activeId: string | undefined;
}

function newGroup(id: string): EditorGroup {
  return { id, editors: [], activeId: undefined, mru: [], size: 1 };
}

function derive(groups: EditorGroup[], activeGroupId: string): EditorsState {
  const active = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  return {
    groups,
    activeGroupId: active?.id ?? activeGroupId,
    editors: groups.flatMap((g) => g.editors),
    activeId: active?.activeId,
  };
}

export const useEditors = create<EditorsState>(() => derive([newGroup('group-1')], 'group-1'));

const SINGLETONS: Record<Exclude<EditorKind, 'query' | 'packUpdate'>, Omit<EditorInput, 'id'>> = {
  welcome: { kind: 'welcome', title: 'Welcome', icon: 'home' },
  settings: { kind: 'settings', title: 'Settings', icon: 'settings' },
  workspaces: { kind: 'workspaces', title: 'Workspaces', icon: 'server' },
};

let queryCounter = 0;
let groupCounter = 1;
const closeListeners = new Set<(editor: EditorInput) => void>();

/** Called when any editor closes (e.g. to dispose its Monaco model). */
export function onEditorClosed(listener: (editor: EditorInput) => void): () => void {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

function update(
  change: (state: EditorsState) => { groups: EditorGroup[]; activeGroupId?: string },
): void {
  useEditors.setState((state) => {
    const next = change(state);
    return derive(next.groups, next.activeGroupId ?? state.activeGroupId);
  });
}

function withActive(group: EditorGroup, id: string | undefined): EditorGroup {
  return {
    ...group,
    activeId: id,
    mru: id === undefined ? group.mru : [id, ...group.mru.filter((m) => m !== id)],
  };
}

export function groupOf(
  id: string,
  state: EditorsState = useEditors.getState(),
): EditorGroup | undefined {
  return state.groups.find((g) => g.editors.some((e) => e.id === id));
}

/** Insert an editor into a group after its active editor, replacing its preview tab. */
function insert(
  group: EditorGroup,
  editor: EditorInput,
): { group: EditorGroup; replaced?: EditorInput } {
  let editors = [...group.editors];
  let replaced: EditorInput | undefined;
  if (editor.preview === true) {
    const previous = editors.find((e) => e.preview === true && e.dirty !== true);
    if (previous !== undefined) {
      replaced = previous;
      editors = editors.filter((e) => e !== previous);
    }
  }
  const activeIndex = editors.findIndex((e) => e.id === group.activeId);
  const pinnedCount = editors.filter((e) => e.pinned === true).length;
  editors.splice(Math.max(activeIndex + 1, editor.pinned === true ? 0 : pinnedCount), 0, editor);
  return {
    group: withActive(
      { ...group, editors, mru: group.mru.filter((m) => m !== replaced?.id) },
      editor.id,
    ),
    ...(replaced === undefined ? {} : { replaced }),
  };
}

/** A fresh query tab id (to prepare a tab's document and targets before opening it). */
export function newQueryEditorId(): string {
  return `query-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface OpenQueryOptions {
  title?: string | undefined;
  /** Reuse an id (restoring tabs). */
  id?: string | undefined;
  preview?: boolean | undefined;
  pinned?: boolean | undefined;
  description?: string | undefined;
  groupId?: string | undefined;
}

/** Open a new query tab ("Query 1", "Query 2", ...) and return its id. */
export function openQueryEditor(titleOrOptions?: string | OpenQueryOptions): string {
  const options: OpenQueryOptions =
    typeof titleOrOptions === 'string' ? { title: titleOrOptions } : (titleOrOptions ?? {});
  queryCounter += 1;
  const editor: EditorInput = {
    id: options.id ?? newQueryEditorId(),
    kind: 'query',
    title: options.title ?? `Query ${String(queryCounter)}`,
    icon: 'file-code',
    ...(options.preview === true ? { preview: true } : {}),
    ...(options.pinned === true ? { pinned: true } : {}),
    ...(options.description === undefined ? {} : { description: options.description }),
  };
  let replaced: EditorInput | undefined;
  update((state) => {
    const targetId = options.groupId ?? state.activeGroupId;
    return {
      groups: state.groups.map((g) => {
        if (g.id !== targetId) return g;
        const result = insert(g, editor);
        replaced = result.replaced;
        return result.group;
      }),
      activeGroupId: targetId,
    };
  });
  if (replaced !== undefined) for (const listener of closeListeners) listener(replaced);
  return editor.id;
}

/** Open (or focus) a singleton editor such as Welcome or Settings. */
/** Open (or focus) an editor with its own id, such as a pack update review. */
export function openEditorInput(input: EditorInput): void {
  const existing = useEditors.getState().editors.find((e) => e.id === input.id);
  if (existing !== undefined) {
    updateEditor(existing.id, { title: input.title });
    activateEditor(existing.id);
    return;
  }
  update((state) => ({
    groups: state.groups.map((g) => (g.id === state.activeGroupId ? insert(g, input).group : g)),
  }));
}

export function openEditor(kind: Exclude<EditorKind, 'query' | 'packUpdate'>): void {
  const existing = useEditors.getState().editors.find((e) => e.kind === kind);
  if (existing !== undefined) {
    activateEditor(existing.id);
    return;
  }
  update((state) => ({
    groups: state.groups.map((g) =>
      g.id === state.activeGroupId ? insert(g, { id: kind, ...SINGLETONS[kind] }).group : g,
    ),
  }));
}

export function activateEditor(id: string): void {
  update((state) => {
    const group = groupOf(id, state);
    if (group === undefined) return { groups: state.groups };
    return {
      groups: state.groups.map((g) => (g === group ? withActive(g, id) : g)),
      activeGroupId: group.id,
    };
  });
}

export function focusGroup(groupId: string): void {
  update((state) =>
    state.groups.some((g) => g.id === groupId)
      ? { groups: state.groups, activeGroupId: groupId }
      : { groups: state.groups },
  );
}

/** Change an editor's title, dirty flag, pin or preview state. */
export function updateEditor(
  id: string,
  patch: Partial<Pick<EditorInput, 'title' | 'dirty' | 'pinned' | 'preview' | 'description'>>,
): void {
  update((state) => ({
    groups: state.groups.map((g) => {
      const index = g.editors.findIndex((e) => e.id === id);
      if (index < 0) return g;
      const editor = { ...g.editors[index], ...patch } as EditorInput;
      // Editing a preview tab keeps it (VS Code): a dirty tab is never a preview.
      if (editor.dirty === true) editor.preview = undefined;
      let editors = g.editors.map((e) => (e.id === id ? editor : e));
      if (patch.pinned !== undefined) {
        // Pinned tabs sit left of the others.
        editors = [
          ...editors.filter((e) => e.pinned === true),
          ...editors.filter((e) => e.pinned !== true),
        ];
      }
      return { ...g, editors };
    }),
  }));
}

/** Close an editor; like VS Code, the MRU neighbour becomes active and empty groups close. */
export function closeEditor(id: string): void {
  const state = useEditors.getState();
  const group = groupOf(id, state);
  const closed = group?.editors.find((e) => e.id === id);
  if (group === undefined || closed === undefined) return;
  update((current) => {
    const groups = current.groups.flatMap((g) => {
      if (g.id !== group.id) return [g];
      const editors = g.editors.filter((e) => e.id !== id);
      const mru = g.mru.filter((m) => m !== id);
      const index = g.editors.findIndex((e) => e.id === id);
      const nextActive =
        g.activeId === id
          ? (mru.find((m) => editors.some((e) => e.id === m)) ??
            editors[Math.min(index, editors.length - 1)]?.id)
          : g.activeId;
      // The last group stays, even when empty (watermark).
      if (editors.length === 0 && current.groups.length > 1) return [];
      return [{ ...g, editors, mru, activeId: nextActive }];
    });
    const activeGroupId = groups.some((g) => g.id === current.activeGroupId)
      ? current.activeGroupId
      : (groups[Math.max(0, current.groups.findIndex((g) => g.id === group.id) - 1)]?.id ??
        current.activeGroupId);
    return { groups, activeGroupId };
  });
  for (const listener of closeListeners) listener(closed);
}

export function closeActiveEditor(): void {
  const { activeId } = useEditors.getState();
  if (activeId !== undefined) closeEditor(activeId);
}

/** Close every editor of a group except `keep` (and pinned ones). */
export function closeOtherEditors(keepId: string): void {
  const group = groupOf(keepId);
  for (const editor of group?.editors ?? []) {
    if (editor.id !== keepId && editor.pinned !== true) closeEditor(editor.id);
  }
}

/** A new, empty group to the right of the active one; returns its id. */
export function splitGroup(): string {
  groupCounter += 1;
  const id = `group-${String(groupCounter)}`;
  update((state) => {
    const index = state.groups.findIndex((g) => g.id === state.activeGroupId);
    const groups = [...state.groups];
    groups.splice(index + 1, 0, newGroup(id));
    return { groups, activeGroupId: id };
  });
  return id;
}

/** Move an editor to a group (drag and drop), at an index (default: end). */
export function moveEditor(id: string, toGroupId: string, index?: number): void {
  const source = groupOf(id);
  const editor = source?.editors.find((e) => e.id === id);
  if (source === undefined || editor === undefined) return;
  update((state) => {
    let groups = state.groups.map((g) => {
      if (g.id !== source.id) return g;
      const editors = g.editors.filter((e) => e.id !== id);
      const mru = g.mru.filter((m) => m !== id);
      return {
        ...g,
        editors,
        mru,
        activeId: g.activeId === id ? (mru[0] ?? editors[0]?.id) : g.activeId,
      };
    });
    groups = groups.map((g) => {
      if (g.id !== toGroupId) return g;
      const editors = [...g.editors];
      editors.splice(Math.min(index ?? editors.length, editors.length), 0, editor);
      return withActive({ ...g, editors }, id);
    });
    // A group emptied by the move closes (unless it's the only one).
    groups = groups.filter(
      (g) => g.editors.length > 0 || g.id === toGroupId || groups.length === 1,
    );
    return { groups, activeGroupId: toGroupId };
  });
}

/** Ctrl+Tab: the previously used editor of the active group. */
export function previousEditorInGroup(): string | undefined {
  const state = useEditors.getState();
  const group = state.groups.find((g) => g.id === state.activeGroupId);
  return group?.mru.find((m) => m !== group.activeId && group.editors.some((e) => e.id === m));
}

export function resizeGroups(sizes: readonly number[]): void {
  update((state) => ({
    groups: state.groups.map((g, i) => ({ ...g, size: Math.max(0.1, sizes[i] ?? g.size) })),
  }));
}

// --- Persistence (spec 05: tabs are restored on start) ----------------------------------------

export interface EditorsSnapshot {
  groups: { id: string; editors: EditorInput[]; activeId: string | undefined; size: number }[];
  activeGroupId: string;
  queryCounter: number;
}

export function editorsSnapshot(): EditorsSnapshot {
  const state = useEditors.getState();
  return {
    groups: state.groups.map((g) => ({
      id: g.id,
      // Previews aren't worth restoring as previews: they come back as normal tabs.
      editors: g.editors.map(({ preview: _preview, ...editor }) => editor),
      activeId: g.activeId,
      size: g.size,
    })),
    activeGroupId: state.activeGroupId,
    queryCounter,
  };
}

export function restoreEditors(snapshot: EditorsSnapshot): void {
  queryCounter = Math.max(queryCounter, snapshot.queryCounter);
  groupCounter = Math.max(
    groupCounter,
    ...snapshot.groups.map((g) => Number(/^group-(\d+)$/.exec(g.id)?.[1] ?? 0)),
  );
  const groups = snapshot.groups
    .filter((g) => g.editors.length > 0)
    .map((g) => ({
      id: g.id,
      editors: g.editors,
      activeId: g.editors.some((e) => e.id === g.activeId) ? g.activeId : g.editors[0]?.id,
      mru: g.activeId === undefined ? [] : [g.activeId],
      size: g.size,
    }));
  const restored = groups.length === 0 ? [newGroup('group-1')] : groups;
  useEditors.setState(derive(restored, snapshot.activeGroupId));
}

/** For tests. */
export function resetEditors(): void {
  queryCounter = 0;
  groupCounter = 1;
  useEditors.setState(derive([newGroup('group-1')], 'group-1'));
}
