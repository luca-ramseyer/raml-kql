import { create } from 'zustand';

/**
 * Open editors (tabs) of the single editor group. Phase 1 has the Welcome page and the
 * Settings editor; query editors (Phase 4), groups and persistence (Phase 7) build on this.
 */
export type EditorKind = 'welcome' | 'settings' | 'workspaces' | 'query';

export interface EditorInput {
  id: string;
  kind: EditorKind;
  title: string;
  icon: string;
}

interface EditorsState {
  editors: EditorInput[];
  activeId: string | undefined;
}

export const useEditors = create<EditorsState>(() => ({ editors: [], activeId: undefined }));

const SINGLETONS: Record<Exclude<EditorKind, 'query'>, Omit<EditorInput, 'id'>> = {
  welcome: { kind: 'welcome', title: 'Welcome', icon: 'home' },
  settings: { kind: 'settings', title: 'Settings', icon: 'settings' },
  workspaces: { kind: 'workspaces', title: 'Workspaces', icon: 'server' },
};

let queryCounter = 0;
const closeListeners = new Set<(editor: EditorInput) => void>();

/** Called when any editor closes (e.g. to dispose its Monaco model). */
export function onEditorClosed(listener: (editor: EditorInput) => void): () => void {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

/** Open a new query tab ("Query 1", "Query 2", ...) and return its id. */
export function openQueryEditor(title?: string): string {
  queryCounter += 1;
  const editor: EditorInput = {
    id: `query-${String(queryCounter)}`,
    kind: 'query',
    title: title ?? `Query ${String(queryCounter)}`,
    icon: 'file-code',
  };
  useEditors.setState((state) => {
    const activeIndex = state.editors.findIndex((e) => e.id === state.activeId);
    const editors = [...state.editors];
    editors.splice(activeIndex + 1, 0, editor);
    return { editors, activeId: editor.id };
  });
  return editor.id;
}

/** Open (or focus) a singleton editor such as Welcome or Settings. */
export function openEditor(kind: Exclude<EditorKind, 'query'>): void {
  useEditors.setState((state) => {
    const existing = state.editors.find((e) => e.kind === kind);
    if (existing !== undefined) return { activeId: existing.id };
    const editor: EditorInput = { id: kind, ...SINGLETONS[kind] };
    const activeIndex = state.editors.findIndex((e) => e.id === state.activeId);
    const editors = [...state.editors];
    editors.splice(activeIndex + 1, 0, editor);
    return { editors, activeId: editor.id };
  });
}

export function activateEditor(id: string): void {
  useEditors.setState({ activeId: id });
}

/** Close an editor; like VS Code, the neighbour to the right (else left) becomes active. */
export function closeEditor(id: string): void {
  useEditors.setState((state) => {
    const index = state.editors.findIndex((e) => e.id === id);
    if (index < 0) return state;
    const closed = state.editors[index];
    if (closed !== undefined) for (const listener of closeListeners) listener(closed);
    const editors = state.editors.filter((e) => e.id !== id);
    const activeId =
      state.activeId === id
        ? (editors[Math.min(index, editors.length - 1)]?.id ?? undefined)
        : state.activeId;
    return { editors, activeId };
  });
}

export function closeActiveEditor(): void {
  const { activeId } = useEditors.getState();
  if (activeId !== undefined) closeEditor(activeId);
}
