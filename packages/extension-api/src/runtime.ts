import type {
  ActivatePayload,
  FetchResult,
  HostToWorker,
  InvokeMessage,
  WorkerToHost,
} from './protocol';
import type {
  CancellationToken,
  Disposable,
  EnrichmentProvider,
  Entity,
  ExtensionContext,
  QuickPickItem,
  RamlKqlApi,
  Webview,
  WebviewViewProvider,
} from './types';

/**
 * The worker side of the extension API (internal to the app's extension host). It turns
 * `ramlKql.*` calls into messages to the host and runs the host's invocations (commands,
 * enrichers, activation) against the extension module.
 */
export interface RuntimePort {
  postMessage(message: WorkerToHost): void;
  onMessage(listener: (message: HostToWorker) => void): void;
}

export interface ExtensionModule {
  activate?: (context: ExtensionContext) => unknown;
  deactivate?: () => unknown;
}

function disposable(dispose: () => void): Disposable {
  let done = false;
  return {
    dispose: () => {
      if (done) return;
      done = true;
      dispose();
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ExtensionRuntime {
  api: RamlKqlApi;
  /** Set the loaded extension module (before `activate` is invoked). */
  setModule(module: ExtensionModule): void;
}

export function createExtensionRuntime(port: RuntimePort): ExtensionRuntime {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const enrichers = new Map<string, EnrichmentProvider>();
  const viewProviders = new Map<string, WebviewViewProvider>();
  const webviewListeners = new Map<string, Set<(message: unknown) => void>>();
  const configListeners = new Set<(keys: string[]) => void>();
  const cancellations = new Map<string, { isCancellationRequested: boolean }>();
  let module: ExtensionModule = {};
  let context: ExtensionContext | undefined;
  const env = { appVersion: '', apiVersion: '', theme: 'dark', presentationMode: true };

  const call = <T>(method: string, args: unknown = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      port.postMessage({ t: 'call', id, method, args });
    });

  const message =
    (severity: 'info' | 'warning' | 'error') =>
    (text: string, ...actions: string[]): Promise<string | undefined> =>
      call<string | undefined>('window.message', { severity, message: text, actions });

  const api: RamlKqlApi = {
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        void call('commands.register', { id }).catch(() => undefined);
        return disposable(() => {
          commands.delete(id);
          void call('commands.unregister', { id }).catch(() => undefined);
        });
      },
      executeCommand: (id, ...args) => call('commands.execute', { id, args }),
    },
    window: {
      showInformationMessage: message('info'),
      showWarningMessage: message('warning'),
      showErrorMessage: message('error'),
      showQuickPick: async (items, options) => {
        const normalized: QuickPickItem[] = items.map((item) =>
          typeof item === 'string' ? { label: item } : item,
        );
        const index = await call<number | undefined>('window.quickPick', {
          items: normalized,
          placeHolder: options?.placeHolder,
        });
        return index === undefined ? undefined : normalized[index];
      },
      showInputBox: (options) => call<string | undefined>('window.inputBox', options ?? {}),
      withProgress: async (options, task) => {
        const progress = await call<number>('window.progressStart', { title: options.title });
        try {
          return await task();
        } finally {
          void call('window.progressEnd', { id: progress }).catch(() => undefined);
        }
      },
    },
    enrichment: {
      registerProvider(id, provider) {
        enrichers.set(id, provider);
        void call('enrichment.register', { id }).catch(() => undefined);
        return disposable(() => enrichers.delete(id));
      },
    },
    views: {
      registerWebviewView(viewId, provider) {
        viewProviders.set(viewId, provider);
        void call('views.register', { viewId }).catch(() => undefined);
        return disposable(() => viewProviders.delete(viewId));
      },
    },
    net: {
      fetch: async (url, init) => {
        const result = await call<FetchResult>('net.fetch', { url, init: init ?? {} });
        return {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          text: () => Promise.resolve(result.body),
          json: () => Promise.resolve(JSON.parse(result.body) as unknown),
        };
      },
    },
    secrets: {
      get: (key) => call('secrets.get', { key }),
      set: (key, value) => call('secrets.set', { key, value }),
      delete: (key) => call('secrets.delete', { key }),
    },
    storage: {
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
    },
    configuration: {
      get: (key) => call('configuration.get', { key }),
      onDidChangeConfiguration(listener) {
        configListeners.add(listener);
        return disposable(() => configListeners.delete(listener));
      },
    },
    editor: {
      getActiveQuery: () => call('editor.getActiveQuery'),
      insertText: (text) => call('editor.insertText', { text }),
      openQueryTab: (options) => call('editor.openQueryTab', options),
    },
    clipboard: {
      writeText: (text) => call('clipboard.writeText', { text }),
    },
    env,
  };

  const webviewFor = (webviewId: string): Webview => ({
    postMessage: (payload) => call('webview.post', { webviewId, message: payload }),
    onDidReceiveMessage(listener) {
      const set = webviewListeners.get(webviewId) ?? new Set();
      set.add(listener);
      webviewListeners.set(webviewId, set);
      return disposable(() => set.delete(listener));
    },
  });

  const run = async (invocation: InvokeMessage): Promise<unknown> => {
    const payload = invocation.payload as Record<string, unknown>;
    switch (invocation.kind) {
      case 'activate': {
        const info = payload as unknown as ActivatePayload;
        Object.assign(env, info.env);
        context = {
          extensionId: info.extensionId,
          extensionVersion: info.version,
          subscriptions: [],
        };
        await module.activate?.(context);
        return undefined;
      }
      case 'deactivate': {
        try {
          await module.deactivate?.();
        } finally {
          for (const item of context?.subscriptions ?? []) {
            try {
              item.dispose();
            } catch {
              // One failing disposable must not keep the others alive.
            }
          }
        }
        return undefined;
      }
      case 'command': {
        const handler = commands.get(String(payload['command']));
        if (handler === undefined)
          throw new Error(`Command ${String(payload['command'])} is not registered.`);
        const args = Array.isArray(payload['args']) ? (payload['args'] as unknown[]) : [];
        return (await handler(...args)) ?? null;
      }
      case 'enrich': {
        const provider = enrichers.get(String(payload['provider']));
        if (provider === undefined)
          throw new Error(`Enricher ${String(payload['provider'])} is not registered.`);
        const token: CancellationToken & { isCancellationRequested: boolean } = {
          isCancellationRequested: false,
        };
        const cancelId = typeof payload['cancelId'] === 'string' ? payload['cancelId'] : '';
        cancellations.set(cancelId, token);
        try {
          return await provider.enrich(payload['entities'] as Entity[], token);
        } finally {
          cancellations.delete(cancelId);
        }
      }
      case 'cancel': {
        const token = cancellations.get(String(payload['cancelId']));
        if (token !== undefined) token.isCancellationRequested = true;
        return undefined;
      }
      case 'webview.resolve': {
        const provider = viewProviders.get(String(payload['viewId']));
        await provider?.resolveWebviewView(webviewFor(String(payload['webviewId'])));
        return undefined;
      }
      case 'webview.message': {
        for (const listener of webviewListeners.get(String(payload['webviewId'])) ?? []) {
          listener(payload['message']);
        }
        return undefined;
      }
      case 'configuration': {
        const keys = Array.isArray(payload['keys']) ? (payload['keys'] as string[]) : [];
        for (const listener of configListeners) listener(keys);
        return undefined;
      }
    }
  };

  port.onMessage((incoming) => {
    if (incoming.t === 'reply') {
      const entry = pending.get(incoming.id);
      if (entry === undefined) return;
      pending.delete(incoming.id);
      if (incoming.ok) entry.resolve(incoming.value);
      else entry.reject(new Error(incoming.error ?? 'The call failed.'));
      return;
    }
    void run(incoming).then(
      (value) => {
        port.postMessage({ t: 'done', id: incoming.id, ok: true, value });
      },
      (error: unknown) => {
        port.postMessage({ t: 'done', id: incoming.id, ok: false, error: errorText(error) });
      },
    );
  });

  return {
    api,
    setModule(loaded) {
      module = loaded;
    },
  };
}
