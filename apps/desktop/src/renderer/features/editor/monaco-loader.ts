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

/** A blank `kusto` model: starts the worker early and resets the completion cache (below). */
const BLANK_URI = 'inmemory://internal/blank.kql';

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
 * service off the main thread). The blank `kusto` model is what starts the worker.
 */
export async function warmUpMonaco(): Promise<void> {
  const { monaco, kusto } = await loadMonaco();
  const uri = monaco.Uri.parse(BLANK_URI);
  if (monaco.editor.getModel(uri) === null) monaco.editor.createModel('', 'kusto', uri);
  const accessor = await kusto.getKustoWorker();
  await accessor(uri);
}

/**
 * monaco-kusto caches completions per word (`completionCacheManager`) and never invalidates
 * the cache when the schema changes, so suggestions requested before the schema arrived would
 * stay stale while that word is typed. Its provider is wrapped: after every schema update, the
 * next request first asks for completions at an empty word in a blank model, which resets the
 * cache. Nothing has to wait for the schema.
 */
function wrapKustoCompletions(monaco: LoadedMonaco['monaco']): {
  schemaApplied: () => void;
  /** The original registration function, for our own (unwrapped) providers. */
  register: LoadedMonaco['monaco']['languages']['registerCompletionItemProvider'];
} {
  type Provider = Parameters<typeof monaco.languages.registerCompletionItemProvider>[1];
  let schemaVersion = 0;
  const languages = monaco.languages;
  const register = languages.registerCompletionItemProvider.bind(languages);
  let wrapped = false;
  languages.registerCompletionItemProvider = (selector, provider) => {
    if (wrapped || selector !== 'kusto') return register(selector, provider);
    wrapped = true; // the first kusto provider after this point is monaco-kusto's adapter
    let seenVersion = schemaVersion;
    const reset = async (
      context: Parameters<Provider['provideCompletionItems']>[2],
      token: Parameters<Provider['provideCompletionItems']>[3],
    ): Promise<void> => {
      const uri = monaco.Uri.parse(BLANK_URI);
      const blank = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', 'kusto', uri);
      await provider.provideCompletionItems(blank, new monaco.Position(1, 1), context, token);
    };
    const proxy: Provider = {
      triggerCharacters: provider.triggerCharacters,
      async provideCompletionItems(model, position, context, token) {
        if (seenVersion !== schemaVersion) {
          seenVersion = schemaVersion;
          await reset(context, token).catch(() => undefined);
        }
        return provider.provideCompletionItems(model, position, context, token);
      },
      ...(provider.resolveCompletionItem === undefined
        ? {}
        : { resolveCompletionItem: provider.resolveCompletionItem.bind(provider) }),
    };
    return register(selector, proxy);
  };
  return {
    schemaApplied: () => {
      schemaVersion += 1;
    },
    register,
  };
}

function configure({ monaco, kusto }: LoadedMonaco): void {
  // Must run before monaco-kusto registers its providers (on the first `kusto` model).
  const completions = wrapKustoCompletions(monaco);
  // Snippets register through the original function: only monaco-kusto's adapter is wrapped.
  completions.register('kusto', snippetProvider(monaco));

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

  // Feed the merged schema of the selected targets to the language service.
  const apply = (schema = useSchema.getState().kusto): void => {
    if (schema === undefined) return;
    void kusto
      .getKustoWorker()
      .then((accessor) => accessor(monaco.Uri.parse(BLANK_URI)))
      .then((worker) =>
        worker.setSchema(schema as unknown as Parameters<typeof worker.setSchema>[0]),
      )
      .then(() => {
        completions.schemaApplied();
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

function snippetProvider(
  monaco: LoadedMonaco['monaco'],
): Parameters<LoadedMonaco['monaco']['languages']['registerCompletionItemProvider']>[1] {
  return {
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
  };
}
