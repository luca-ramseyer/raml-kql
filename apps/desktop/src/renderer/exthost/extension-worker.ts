import { createExtensionRuntime, type ExtensionModule } from '@raml-kql/extension-api/runtime';

/**
 * One extension's worker. The first message carries the extension's bundled code and the port
 * to main; the code is loaded as a module from a blob URL and gets `ramlKql` as its only
 * connection to the outside. Network APIs are removed here too, but the real barrier is the
 * CSP and the blocked session (an extension cannot reach anything except through
 * `ramlKql.net.fetch`, which main checks).
 */
const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'importScripts',
];

function lockDown(): void {
  for (const name of BLOCKED) {
    try {
      Object.defineProperty(globalThis, name, {
        value: () => {
          throw new Error(`${name} is not available to extensions. Use ramlKql.net.fetch.`);
        },
        writable: false,
        configurable: false,
      });
    } catch {
      // Not defined in this worker: nothing to remove.
    }
  }
}

self.onmessage = (event: MessageEvent<{ code: string }>) => {
  self.onmessage = null;
  const [port] = event.ports;
  if (port === undefined) return;
  const runtime = createExtensionRuntime({
    postMessage: (message) => {
      port.postMessage(message);
    },
    onMessage: (listener) => {
      port.onmessage = (incoming: MessageEvent) => {
        listener(incoming.data as Parameters<typeof listener>[0]);
      };
    },
  });
  (globalThis as { ramlKql?: unknown }).ramlKql = runtime.api;
  lockDown();
  const url = URL.createObjectURL(new Blob([event.data.code], { type: 'text/javascript' }));
  import(/* @vite-ignore */ url)
    .then((module: ExtensionModule) => {
      URL.revokeObjectURL(url);
      runtime.setModule(module);
      port.postMessage({ t: 'ready' });
    })
    .catch((error: unknown) => {
      port.postMessage({
        t: 'fatal',
        error: error instanceof Error ? error.message : String(error),
      });
    });
};
