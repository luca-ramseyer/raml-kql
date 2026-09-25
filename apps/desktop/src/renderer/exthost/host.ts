/**
 * The extension host page (spec 01/07): a hidden window whose only job is to run one Web Worker
 * per extension. It has no IPC and no network (CSP `connect-src 'none'`, and its session
 * blocks every request). Main sends each extension's code and a MessagePort through the
 * preload; from then on the worker talks to main directly over that port.
 */
interface StartMessage {
  type: 'start';
  id: string;
  code: string;
}

interface StopMessage {
  type: 'stop';
  id: string;
}

const workers = new Map<string, Worker>();

window.addEventListener('message', (event: MessageEvent<StartMessage | StopMessage>) => {
  // Only the preload (same window) sends these.
  if (event.source !== window) return;
  const message = event.data;
  if (message.type === 'start') {
    const [port] = event.ports;
    if (port === undefined) return;
    workers.get(message.id)?.terminate();
    const worker = new Worker(new URL('./extension-worker.ts', import.meta.url), {
      type: 'module',
      name: message.id,
    });
    worker.postMessage({ code: message.code }, [port]);
    workers.set(message.id, worker);
  } else {
    workers.get(message.id)?.terminate();
    workers.delete(message.id);
  }
});
