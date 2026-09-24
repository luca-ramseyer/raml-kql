import type { AppErrorData } from '../shared/errors';
import {
  describeIssues,
  fail,
  IpcResultEnvelopeSchema,
  ok,
  type AnyChannel,
  type IpcResult,
} from '../shared/ipc/channel';
import { ipcContracts, listChannels, type RamlKqlApi } from '../shared/ipc/contracts';
import { eventChannel, ipcEvents, type RamlKqlEventsApi } from '../shared/ipc/events';

type RendererListener = (event: unknown, ...args: unknown[]) => void;

/** The subset of Electron's `ipcRenderer` the API needs (keeps it testable). */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: RendererListener): unknown;
  removeListener(channel: string, listener: RendererListener): unknown;
}

function preloadError(code: AppErrorData['code'], message: string, detail?: string): AppErrorData {
  return {
    code,
    message,
    ...(detail === undefined ? {} : { detail }),
    retryable: false,
    source: 'preload',
  };
}

async function invokeChannel(
  ipcRenderer: IpcRendererLike,
  channel: AnyChannel,
  request: unknown,
): Promise<IpcResult<unknown>> {
  const parsedRequest = channel.request.safeParse(request);
  if (!parsedRequest.success) {
    return fail(
      preloadError(
        'IPC_INVALID_REQUEST',
        `Invalid request for ${channel.name}.`,
        describeIssues(parsedRequest.error),
      ),
    );
  }

  const raw = await ipcRenderer.invoke(
    channel.name,
    ...(parsedRequest.data === undefined ? [] : [parsedRequest.data]),
  );

  const envelope = IpcResultEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return fail(preloadError('IPC_INVALID_RESPONSE', `Malformed response from ${channel.name}.`));
  }
  if (!envelope.data.ok) {
    return envelope.data;
  }

  const parsedResponse = channel.response.safeParse(envelope.data.value);
  if (!parsedResponse.success) {
    return fail(
      preloadError(
        'IPC_INVALID_RESPONSE',
        `Invalid response from ${channel.name}.`,
        describeIssues(parsedResponse.error),
      ),
    );
  }
  return ok(parsedResponse.data);
}

function createEventsApi(ipcRenderer: IpcRendererLike): RamlKqlEventsApi {
  return {
    on(name, listener) {
      if (!Object.hasOwn(ipcEvents, name)) {
        throw new Error(`Unknown event: ${name}`);
      }
      const schema = ipcEvents[name];
      const channel = eventChannel(name);
      // The Electron event object is deliberately not forwarded (it exposes `sender`).
      const wrapped: RendererListener = (_event, payload) => {
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          console.warn(`Dropped invalid ${channel} payload: ${describeIssues(parsed.error)}`);
          return;
        }
        (listener as (payload: unknown) => void)(parsed.data);
      };
      ipcRenderer.on(channel, wrapped);
      return () => {
        ipcRenderer.removeListener(channel, wrapped);
      };
    },
  };
}

/**
 * Build the object exposed as `window.ramlKql`: one async method per contract entry.
 * Methods never throw for expected failures; they resolve to an `IpcResult` envelope.
 */
export function createRamlKqlApi(ipcRenderer: IpcRendererLike): RamlKqlApi {
  const api: Record<string, unknown> = {};
  for (const { namespace, method, channel } of listChannels(ipcContracts)) {
    const methods = (api[namespace] ??= {}) as Record<
      string,
      (request?: unknown) => Promise<IpcResult<unknown>>
    >;
    methods[method] = (request?: unknown) => invokeChannel(ipcRenderer, channel, request);
  }
  api['events'] = createEventsApi(ipcRenderer);
  return api as RamlKqlApi;
}
