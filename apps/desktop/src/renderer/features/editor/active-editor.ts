import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import { useEditors } from '../../platform/editors';

/**
 * Mounted Monaco editors by query tab. Each editor group shows one editor at a time, so
 * several can be mounted side by side; commands act on the active group's editor.
 */
const mounted = new Map<string, Monaco.editor.IStandaloneCodeEditor>();

export function setActiveCodeEditor(
  editorId: string,
  editor: Monaco.editor.IStandaloneCodeEditor | undefined,
): void {
  if (editor !== undefined) mounted.set(editorId, editor);
  else mounted.delete(editorId);
}

/** The Monaco editor of the active query tab (active group), if it is mounted. */
export function getActiveCodeEditor(): Monaco.editor.IStandaloneCodeEditor | undefined {
  const { activeId } = useEditors.getState();
  return activeId === undefined ? undefined : mounted.get(activeId);
}

/** The Monaco editor of a query tab, if it is mounted. */
export function getCodeEditor(editorId: string): Monaco.editor.IStandaloneCodeEditor | undefined {
  return mounted.get(editorId);
}

/** Run a Monaco editor action (e.g. `editor.action.formatDocument`) on the active query tab. */
export async function runEditorAction(actionId: string): Promise<void> {
  const editor = getActiveCodeEditor();
  if (editor === undefined) return;
  editor.focus();
  await editor.getAction(actionId)?.run();
}
