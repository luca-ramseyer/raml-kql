import type {
  CallMessage,
  HostToWorker,
  InvokeKind,
  WorkerToHost,
} from '@raml-kql/extension-api/protocol';

/**
 * Main's end of one extension worker's port (spec 07, "Runtime architecture"): answers the
 * worker's API calls, invokes extension code with timeouts, and rate-limits calls.
 */
export interface ConnectionPort {
  postMessage(message: HostToWorker): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

export interface ConnectionOptions {
  handle: (call: CallMessage) => Promise<unknown>;
  /** Calls per second before calls are refused. */
  maxCallsPerSecond?: number;
  now?: () => number;
}

export class ExtensionConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private readonly ready: Promise<void>;
  private window = { start: 0, count: 0 };
  private closed = false;

  constructor(
    private readonly port: ConnectionPort,
    private readonly options: ConnectionOptions,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.ready.catch(() => undefined);
    port.on('message', ({ data }) => {
      this.receive(data as WorkerToHost);
    });
    port.start();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private receive(message: WorkerToHost): void {
    if (message.t === 'ready') {
      this.readyResolve?.();
      return;
    }
    if (message.t === 'fatal') {
      this.readyReject?.(new Error(message.error));
      return;
    }
    if (message.t === 'done') {
      const entry = this.pending.get(message.id);
      if (entry === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new Error(message.error ?? 'The extension failed.'));
      return;
    }
    const now = this.now();
    if (now - this.window.start >= 1000) this.window = { start: now, count: 0 };
    this.window.count += 1;
    if (this.window.count > (this.options.maxCallsPerSecond ?? 200)) {
      this.send({ t: 'reply', id: message.id, ok: false, error: 'Too many calls: slow down.' });
      return;
    }
    this.options.handle(message).then(
      (value) => {
        this.send({ t: 'reply', id: message.id, ok: true, value: value ?? null });
      },
      (error: unknown) => {
        this.send({
          t: 'reply',
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private send(message: HostToWorker): void {
    if (!this.closed) this.port.postMessage(message);
  }

  /** Wait until the worker loaded the extension module. */
  waitReady(timeoutMs: number): Promise<void> {
    return withTimeout(this.ready, timeoutMs, 'The extension did not start within 10 seconds.');
  }

  invoke(kind: InvokeKind, payload: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The extension is not running.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The extension did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: 'invoke', id, kind, payload });
    });
  }

  close(): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('The extension was stopped.'));
    }
    this.pending.clear();
    this.readyReject?.(new Error('The extension was stopped.'));
    this.port.close();
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
