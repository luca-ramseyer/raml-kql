/**
 * Lazily loads Monaco with the Kusto language (spec 05, "Editor"). Everything is bundled: no
 * CDN loader, and workers are Vite-built module workers from our own origin (CSP
 * `worker-src 'self'`).
 */
// eslint-disable-next-line import-x/default -- `?worker` is a Vite import; see vite-env-workers.d.ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';

import { KQL_SNIPPETS, snippetPreview } from './kql-snippets';
import KustoWorker from './kusto.worker?worker';
import { completionSuffix, markSchemaApplied, useSchema } from './schema-store';

type MonacoModule = typeof import('monaco-editor/esm/vs/editor/editor.api.js');
type KustoModule = typeof import('@kusto/monaco-kusto');

export interface LoadedMonaco {
  monaco: MonacoModule;
  kusto: KustoModule;
}

let loading: Promise<LoadedMonaco> | undefined;

export function loadMonaco(): Promise<LoadedMonaco> {
  loading ??= (async () => {
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_moduleId: string, label: string): Worker {
        return label === 'kusto' ? new KustoWorker() : new EditorWorker();
      },
    };
    // edcore.main = the editor with every editor contribution (find, multi-cursor, folding,
    // suggest, ...) but none of Monaco's other languages.
    const monaco =
      (await import('monaco-editor/esm/vs/editor/edcore.main.js')) as unknown as MonacoModule;
    const kusto = await import('@kusto/monaco-kusto');
    const loaded = { monaco, kusto };
    configure(loaded);
    return loaded;
  })();
  return loading;
}

/**
 * Load Monaco and start the Kusto worker ahead of time (the worker parses ~10 MB of language
 * service off the main thread). A throwaway `kusto` model is what starts the worker.
 */
export async function warmUpMonaco(): Promise<void> {
  const { monaco, kusto } = await loadMonaco();
  const uri = monaco.Uri.parse('inmemory://warmup/warmup.kql');
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', 'kusto', uri);
  try {
    const accessor = await kusto.getKustoWorker();
    await accessor(uri);
  } finally {
    model.dispose();
  }
}

function configure({ monaco, kusto }: LoadedMonaco): void {
  kusto.kustoDefaults.setLanguageSettings({
    ...kusto.kustoDefaults.languageSettings,
    includeControlCommands: false, // Log Analytics is read-only: no `.` management commands
    newlineAfterPipe: true,
    enableHover: true,
    enableQueryWarnings: false,
    completionOptions: { includeExtendedSyntax: false },
    onDidProvideCompletionItems: (list) => {
      for (const item of list.items) {
        const suffix = completionSuffix(item.label);
        if (suffix !== undefined) item.detail = suffix;
      }
      return Promise.resolve(list);
    },
  });

  // F1 is the workbench's command palette, not Monaco's own.
  monaco.editor.addKeybindingRule({
    keybinding: monaco.KeyCode.F1,
    command: '-editor.action.quickCommand',
  });

  monaco.languages.registerCompletionItemProvider('kusto', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      return {
        suggestions: KQL_SNIPPETS.map((snippet) => ({
          label: { label: snippet.prefix, description: snippet.label },
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: snippet.description,
          documentation: { value: '```kusto\n' + snippetPreview(snippet.body) + '\n```' },
          insertText: snippet.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `~${snippet.prefix}`, // after schema items
        })),
      };
    },
  });

  // Feed the merged schema of the selected targets to the language service.
  const apply = (schema = useSchema.getState().kusto): void => {
    if (schema === undefined) return;
    void kusto
      .getKustoWorker()
      .then((accessor) => accessor(monaco.Uri.parse('inmemory://query/schema')))
      .then((worker) =>
        worker.setSchema(schema as unknown as Parameters<typeof worker.setSchema>[0]),
      )
      .then(() => {
        markSchemaApplied(schema);
      })
      .catch((error: unknown) => {
        console.error('Could not set the Kusto schema', error);
      });
  };
  useSchema.subscribe((state, previous) => {
    if (state.kusto !== previous.kusto) apply(state.kusto);
  });
  apply();
}
