/**
 * Loading the query editor (Monaco, the Kusto language service and its worker) takes a
 * noticeable moment. It is done ahead of time while the app is idle after start-up, so the
 * first query tab opens at once. Only code is loaded: no schema is fetched until a query tab
 * opens (D-029), so nothing goes over the network.
 */
export type QueryEditorComponent = (props: { editorId: string }) => React.JSX.Element;

let component: QueryEditorComponent | undefined;
let loading: Promise<QueryEditorComponent> | undefined;

export function loadQueryEditor(): Promise<QueryEditorComponent> {
  loading ??= import('./QueryEditor').then((module) => {
    component = module.QueryEditor;
    return module.QueryEditor;
  });
  return loading;
}

/** The editor component if it has already loaded (render without waiting). */
export function loadedQueryEditor(): QueryEditorComponent | undefined {
  return component;
}

/** Warm up the editor during idle time. Returns a function that cancels a pending warm-up. */
export function preloadQueryEditorWhenIdle(): () => void {
  const warmUp = (): void => {
    void loadQueryEditor()
      .then(async () => {
        const { warmUpMonaco } = await import('./monaco-loader');
        await warmUpMonaco();
      })
      .catch((error: unknown) => {
        // Not fatal: the editor loads (and reports errors) when a query tab opens.
        console.warn('Editor preload failed', error);
      });
  };
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(warmUp, { timeout: 1500 });
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const timer = setTimeout(warmUp, 2000);
  return () => {
    clearTimeout(timer);
  };
}
