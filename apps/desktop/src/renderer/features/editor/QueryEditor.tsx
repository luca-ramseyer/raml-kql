import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useEffect, useRef, useState } from 'react';

import { executeCommand } from '../../platform/commands';
import { setContextKey } from '../../platform/context-keys';
import { activateEditor, updateEditor, useEditors } from '../../platform/editors';
import { useKeybindingLabel } from '../../platform/keybindings/keybinding-service';
import { useSetting } from '../../platform/settings';
import { useTheme } from '../../platform/theme/theme-service';
import { Codicon } from '../../workbench/common/Codicon';
import { updateQueryDoc, useQueryDocs } from '../query/query-docs';
import { useRuns } from '../query/run-store';

import { setActiveCodeEditor } from './active-editor';
import { loadMonaco, type LoadedMonaco } from './monaco-loader';
import { MONACO_THEME_NAME, toMonacoTheme } from './monaco-theme';
import { queryModelFor } from './query-models';
import { startSchemaSync, useSchema } from './schema-store';
import { filtersOnTimeGenerated, type Classification } from './time-filter';
import { TimeRangePicker } from './TimeRangePicker';

import './QueryEditor.css';

/** The platform editor font, as VS Code picks it (spec 05, "Fonts"). */
function defaultFont(): { family: string; size: number } {
  const agent = navigator.userAgent;
  if (agent.includes('Mac')) return { family: 'Menlo, Monaco, "Courier New", monospace', size: 12 };
  if (agent.includes('Windows')) return { family: 'Consolas, "Courier New", monospace', size: 14 };
  return { family: '"Droid Sans Mono", "monospace", monospace', size: 14 };
}

let themeSynced = false;
/** Keep Monaco's theme in step with the workbench theme (tokenColors → Monaco rules). */
function syncTheme({ monaco }: LoadedMonaco): void {
  const apply = (): void => {
    monaco.editor.defineTheme(MONACO_THEME_NAME, toMonacoTheme(useTheme.getState().active));
    monaco.editor.setTheme(MONACO_THEME_NAME);
  };
  apply();
  if (themeSynced) return;
  themeSynced = true;
  useTheme.subscribe((state, previous) => {
    if (state.active !== previous.active) apply();
  });
}

interface ClassifyingWorker {
  getClassifications(uri: string): Promise<Classification[]>;
}

/** Debounced "Set in query" detection from the Kusto classifier (spec 05). */
function watchTimeFilter(
  loaded: LoadedMonaco,
  editorId: string,
  model: Monaco.editor.ITextModel,
): Monaco.IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void loaded.kusto
        .getKustoWorker()
        .then((accessor) => accessor(model.uri))
        // The worker is monaco-kusto's augmented worker; the public type omits this method.
        .then((worker) =>
          (worker as unknown as ClassifyingWorker).getClassifications(model.uri.toString()),
        )
        .then((classifications) => {
          if (model.isDisposed()) return;
          updateQueryDoc(editorId, {
            timeSetInQuery: filtersOnTimeGenerated(model.getValue(), classifications),
          });
        })
        .catch(() => undefined);
    }, 300);
  };
  const listener = model.onDidChangeContent(() => {
    updateQueryDoc(editorId, { text: model.getValue() });
    // Editing a preview tab keeps it open (VS Code).
    if (useEditors.getState().editors.find((e) => e.id === editorId)?.preview === true) {
      updateEditor(editorId, { preview: false });
    }
    check();
  });
  check();
  return {
    dispose: () => {
      clearTimeout(timer);
      listener.dispose();
    },
  };
}

/** A KQL query tab (spec 05, "Editor"): toolbar with Run and the time range, then Monaco. */
export function QueryEditor({ editorId }: { editorId: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const doc = useQueryDocs((s) => s.docs[editorId]);
  const minimap = useSetting('editor.minimap.enabled');
  const wordWrap = useSetting('editor.wordWrap');
  const fontFamily = useSetting('editor.fontFamily');
  const fontSize = useSetting('editor.fontSize');
  const run = useRuns((s) => s.byTab[editorId]);
  const running = run?.state === 'running';
  const schemaLoading = useSchema((s) => s.loading);
  // Completions pick up the schema whenever it arrives; typing never waits for it.
  const schemaReady = useSchema(
    (s) => !s.loading && s.kusto !== undefined && s.applied === s.kusto,
  );
  const runKey = useKeybindingLabel('query.run');
  const cancelKey = useKeybindingLabel('query.cancel');

  useEffect(() => {
    let disposed = false;
    // A function, so type narrowing doesn't assume the flag is unchanged across awaits.
    const isDisposed = (): boolean => disposed;
    const disposables: Monaco.IDisposable[] = [];
    let saveViewState: (() => void) | undefined;
    startSchemaSync();

    loadMonaco()
      .then((loaded) => {
        if (isDisposed() || container.current === null) return;
        const entry = queryModelFor(
          loaded,
          editorId,
          useQueryDocs.getState().docs[editorId]?.text ?? '',
        );
        syncTheme(loaded);
        const editor = loaded.monaco.editor.create(container.current, {
          model: entry.model,
          theme: MONACO_THEME_NAME,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          fixedOverflowWidgets: true,
          bracketPairColorization: { enabled: true },
          ariaLabel: 'Query editor',
          tabSize: 2,
          minimap: { enabled: false },
          suggest: { showInlineDetails: true },
        });
        if (entry.viewState !== null) {
          editor.restoreViewState(entry.viewState);
        } else {
          // A restored tab: put the cursor back where it was (spec 05).
          const cursor = useQueryDocs.getState().docs[editorId]?.cursor;
          if (cursor !== undefined) {
            editor.setPosition({ lineNumber: cursor.line, column: cursor.column });
            editor.revealLineInCenterIfOutsideViewport(cursor.line);
          }
        }
        editorRef.current = editor;
        setActiveCodeEditor(editorId, editor);
        saveViewState = () => {
          entry.viewState = editor.saveViewState();
        };
        disposables.push(
          watchTimeFilter(loaded, editorId, entry.model),
          editor.onDidChangeCursorPosition((event) => {
            updateQueryDoc(editorId, {
              cursor: { line: event.position.lineNumber, column: event.position.column },
            });
          }),
          editor.onDidFocusEditorText(() => {
            setContextKey('editorTextFocus', true);
            // Focusing an editor makes its group (and tab) the active one.
            if (useEditors.getState().activeId !== editorId) activateEditor(editorId);
          }),
          editor.onDidBlurEditorText(() => {
            setContextKey('editorTextFocus', false);
          }),
        );
        // Run from inside the editor (Monaco would otherwise take Ctrl/Cmd+Enter itself).
        const { KeyCode, KeyMod } = loaded.monaco;
        for (const keybinding of [KeyMod.Shift | KeyCode.Enter, KeyMod.CtrlCmd | KeyCode.Enter]) {
          editor.addCommand(keybinding, () => void executeCommand('query.run'));
        }
        // Escape cancels a running query, unless an editor widget wants it first.
        const runningKey = editor.createContextKey(
          'ramlQueryRunning',
          useRuns.getState().byTab[editorId]?.state === 'running',
        );
        const unsubscribeRuns = useRuns.subscribe((state) => {
          runningKey.set(state.byTab[editorId]?.state === 'running');
        });
        disposables.push({ dispose: unsubscribeRuns });
        editor.addCommand(
          KeyCode.Escape,
          () => void executeCommand('query.cancel'),
          'ramlQueryRunning && !suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible',
        );
        if (useEditors.getState().activeId === editorId) editor.focus();
        setState('ready');
      })
      .catch((error: unknown) => {
        console.error('Monaco failed to load', error);
        if (!isDisposed()) setState('failed');
      });

    return () => {
      disposed = true;
      saveViewState?.();
      for (const disposable of disposables) disposable.dispose();
      setActiveCodeEditor(editorId, undefined);
      setContextKey('editorTextFocus', false);
      editorRef.current?.dispose(); // the model stays; it belongs to the tab
      editorRef.current = undefined;
    };
  }, [editorId]);

  // Editor settings apply live.
  useEffect(() => {
    const font = defaultFont();
    editorRef.current?.updateOptions({
      minimap: { enabled: minimap },
      wordWrap,
      fontFamily: fontFamily.trim() === '' ? font.family : fontFamily,
      fontSize: fontSize === 0 ? font.size : fontSize,
    });
  }, [minimap, wordWrap, fontFamily, fontSize, state]);

  return (
    <div className="query-editor">
      <div className="query-toolbar" role="toolbar" aria-label="Query">
        {running ? (
          <button
            type="button"
            className="button button-secondary query-run"
            title={`Cancel (${cancelKey ?? 'Escape'})`}
            onClick={() => void executeCommand('query.cancel')}
          >
            <Codicon name="debug-stop" />
            <span>Cancel</span>
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary query-run"
            title={runKey === undefined ? 'Run' : `Run (${runKey})`}
            onClick={() => void executeCommand('query.run')}
          >
            <Codicon name="play" />
            <span>Run</span>
          </button>
        )}
        {doc === undefined ? null : (
          <TimeRangePicker
            value={doc.timeRange}
            setInQuery={doc.timeSetInQuery}
            onChange={(timeRange) => {
              updateQueryDoc(editorId, { timeRange });
            }}
          />
        )}
        {schemaLoading ? (
          <span className="query-toolbar-status" role="status">
            <Codicon name="loading" className="codicon-modifier-spin" /> Loading schema…
          </span>
        ) : null}
      </div>
      <div
        className="query-monaco"
        ref={container}
        data-state={state}
        data-schema={schemaReady ? 'ready' : 'loading'}
      >
        {state === 'loading' ? <div className="query-editor-message">Loading editor…</div> : null}
        {state === 'failed' ? (
          <div className="query-editor-message" role="alert">
            The editor failed to load. Reload the window and report the problem if it persists.
          </div>
        ) : null}
      </div>
    </div>
  );
}
