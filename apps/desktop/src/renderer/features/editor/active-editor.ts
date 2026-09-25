import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

/**
 * The Monaco editor of the active query tab, for commands that act on it (Format Document,
 * Toggle Line Comment, ...). Only one query editor is mounted at a time.
 */
let active: { editorId: string; editor: Monaco.editor.IStandaloneCodeEditor } | undefined;

export function setActiveCodeEditor(
  editorId: string,
  editor: Monaco.editor.IStandaloneCodeEditor | undefined,
): void {
  if (editor !== undefined) active = { editorId, editor };
  else if (active?.editorId === editorId) active = undefined;
}

export function getActiveCodeEditor(): Monaco.editor.IStandaloneCodeEditor | undefined {
  return active?.editor;
}

/** Run a Monaco editor action (e.g. `editor.action.formatDocument`) on the active query tab. */
export async function runEditorAction(actionId: string): Promise<void> {
  const editor = active?.editor;
  if (editor === undefined) return;
  editor.focus();
  await editor.getAction(actionId)?.run();
}
