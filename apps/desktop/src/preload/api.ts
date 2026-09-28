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

/** The subset of Electron's `ipcRenderer` the API needs (keeps it testable). */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
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

/**
 * Build the object exposed as `window.ramlKql`: one async method per contract entry.
 * Methods never throw for expected failures; they resolve to an `IpcResult` envelope.
 */
export function createRamlKqlApi(ipcRenderer: IpcRendererLike): RamlKqlApi {
  const api: Record<
    string,
    Record<string, (request?: unknown) => Promise<IpcResult<unknown>>>
  > = {};
  for (const { namespace, method, channel } of listChannels(ipcContracts)) {
    const methods = (api[namespace] ??= {});
    methods[method] = (request?: unknown) => invokeChannel(ipcRenderer, channel, request);
  }
  return api as unknown as RamlKqlApi;
}
