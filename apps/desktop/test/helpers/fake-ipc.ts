import type { InvokeEventLike, IpcMainLike } from '../../src/main/ipc/router';
import type { IpcRendererLike } from '../../src/preload/api';

type Listener = (event: InvokeEventLike, ...args: unknown[]) => Promise<unknown>;

/**
 * In-memory stand-in for Electron's ipcMain/ipcRenderer pair. Payloads go through
 * `structuredClone`, like Electron's real serialization, so tests catch non-cloneable data.
 */
export class FakeIpcBus {
  readonly handlers = new Map<string, Listener>();
  senderUrl: string | null = 'raml-kql://app/index.html';

  readonly ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      if (this.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      this.handlers.set(channel, listener);
    },
    removeHandler: (channel) => {
      this.handlers.delete(channel);
    },
  };

  readonly ipcRenderer: IpcRendererLike = {
    invoke: async (channel, ...args) => {
      const listener = this.handlers.get(channel);
      if (listener === undefined) {
        throw new Error(`No handler registered for '${channel}'`);
      }
      const event: InvokeEventLike = {
        senderFrame: this.senderUrl === null ? null : { url: this.senderUrl },
      };
      const result = await listener(event, ...args.map((arg) => structuredClone(arg)));
      return structuredClone(result);
    },
  };
}
