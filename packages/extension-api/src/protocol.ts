/**
 * Messages between an extension's worker and the host's ExtensionManager (spec 07). Internal:
 * extension authors use `ramlKql`, not these messages. The host validates every call with
 * zod and checks permissions in the main process, never in the worker.
 */

/** Worker → host: an API call. */
export interface CallMessage {
  t: 'call';
  id: number;
  method: string;
  args: unknown;
}

/** Host → worker: the answer to a call. */
export interface ReplyMessage {
  t: 'reply';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type InvokeKind =
  | 'activate'
  | 'deactivate'
  | 'command'
  | 'enrich'
  | 'cancel'
  | 'webview.resolve'
  | 'webview.message'
  | 'configuration';

/** Host → worker: run extension code (a command, an enricher, activation…). */
export interface InvokeMessage {
  t: 'invoke';
  id: number;
  kind: InvokeKind;
  payload: unknown;
}

/** Worker → host: the result of an invocation. */
export interface DoneMessage {
  t: 'done';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Worker → host: the extension module loaded. */
export interface ReadyMessage {
  t: 'ready';
}

/** Worker → host: the extension module couldn't load. */
export interface FatalMessage {
  t: 'fatal';
  error: string;
}

export type WorkerToHost = CallMessage | DoneMessage | ReadyMessage | FatalMessage;
export type HostToWorker = ReplyMessage | InvokeMessage;

export interface ActivatePayload {
  extensionId: string;
  version: string;
  env: { appVersion: string; apiVersion: string; theme: string; presentationMode: boolean };
}

/** What `net.fetch` returns over the port (the runtime wraps it into a Response-like object). */
export interface FetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
