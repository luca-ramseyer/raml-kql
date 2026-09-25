import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import type { LoadedMonaco } from './monaco-loader';

/**
 * One Monaco model per query tab. Models (and their undo history and view state) live as long
 * as the tab, not the mounted editor, so switching tabs loses nothing.
 */
interface QueryModel {
  model: Monaco.editor.ITextModel;
  viewState: Monaco.editor.ICodeEditorViewState | null;
}

const models = new Map<string, QueryModel>();

export function queryModelFor(loaded: LoadedMonaco, editorId: string, text: string): QueryModel {
  let entry = models.get(editorId);
  if (entry === undefined || entry.model.isDisposed()) {
    entry = {
      model: loaded.monaco.editor.createModel(
        text,
        'kusto',
        loaded.monaco.Uri.parse(`inmemory://query/${editorId}.kql`),
      ),
      viewState: null,
    };
    models.set(editorId, entry);
  }
  return entry;
}

export function disposeQueryModel(editorId: string): void {
  models.get(editorId)?.model.dispose();
  models.delete(editorId);
}
