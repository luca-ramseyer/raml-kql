import { AppError, type AppErrorData } from '../../shared/errors';
import { describeIssues, fail, ok, type IpcResult } from '../../shared/ipc/channel';
import {
  ipcContracts,
  listChannels,
  type IpcHandlerContext,
  type IpcHandlers,
} from '../../shared/ipc/contracts';

/** The subset of Electron's `IpcMainInvokeEvent` the router needs (keeps it testable). */
export interface InvokeEventLike {
  readonly senderFrame: { readonly url: string } | null;
}

/** The subset of Electron's `ipcMain` the router needs. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: InvokeEventLike, ...args: unknown[]) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export interface IpcRouterOptions {
  ipcMain: IpcMainLike;
  handlers: IpcHandlers;
  /** Returns true only for frames that belong to our own workbench. */
  isTrustedSender: (senderUrl: string) => boolean;
  /** Called for unexpected handler failures. Must not log request payloads. */
  onInternalError?: (channel: string, error: unknown) => void;
}

function mainError(code: AppErrorData['code'], message: string, detail?: string): AppErrorData {
  return {
    code,
    message,
    ...(detail === undefined ? {} : { detail }),
    retryable: false,
    source: 'main',
  };
}

/**
 * Registers one `ipcMain.handle` listener per contract entry. Every call:
 * 1. rejects senders that aren't our workbench,
 * 2. validates the request with the channel's zod schema,
 * 3. runs the handler,
 * 4. validates the handler's response (catches main-process bugs before they reach the UI),
 * 5. wraps the outcome in an {@link IpcResult} envelope.
 *
 * Returns a function that unregisters every handler.
 */
export function registerIpcRouter(options: IpcRouterOptions): () => void {
  const { ipcMain, handlers, isTrustedSender, onInternalError } = options;
  const registered: string[] = [];

  for (const { namespace, method, channel } of listChannels(ipcContracts)) {
    const handler = (
      handlers as unknown as Record<
        string,
        Record<string, (req: unknown, ctx: IpcHandlerContext) => unknown>
      >
    )[namespace]?.[method];
    if (handler === undefined) {
      throw new Error(`No IPC handler registered for ${channel.name}`);
    }

    ipcMain.handle(channel.name, async (event, ...args): Promise<IpcResult<unknown>> => {
      const senderUrl = event.senderFrame?.url ?? '';
      if (!isTrustedSender(senderUrl)) {
        return fail(mainError('IPC_UNTRUSTED_SENDER', 'Request rejected: untrusted sender.'));
      }

      if (args.length > 1) {
        return fail(mainError('IPC_INVALID_REQUEST', `Invalid request for ${channel.name}.`));
      }
      const parsedRequest = channel.request.safeParse(args[0]);
      if (!parsedRequest.success) {
        return fail(
          mainError(
            'IPC_INVALID_REQUEST',
            `Invalid request for ${channel.name}.`,
            describeIssues(parsedRequest.error),
          ),
        );
      }

      let rawResponse: unknown;
      try {
        rawResponse = await handler(parsedRequest.data, { senderUrl });
      } catch (error) {
        if (error instanceof AppError) {
          return fail(error.toData());
        }
        onInternalError?.(channel.name, error);
        return fail(mainError('INTERNAL', 'An unexpected error occurred.'));
      }

      const parsedResponse = channel.response.safeParse(rawResponse);
      if (!parsedResponse.success) {
        onInternalError?.(channel.name, parsedResponse.error);
        return fail(
          mainError(
            'IPC_INVALID_RESPONSE',
            `Invalid response from ${channel.name}.`,
            describeIssues(parsedResponse.error),
          ),
        );
      }
      return ok(parsedResponse.data);
    });
    registered.push(channel.name);
  }

  return () => {
    for (const name of registered) {
      ipcMain.removeHandler(name);
    }
  };
}
