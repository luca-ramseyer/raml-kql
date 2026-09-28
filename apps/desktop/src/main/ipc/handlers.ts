import type { AppInfo, IpcHandlers } from '../../shared/ipc/contracts';

export interface HandlerDependencies {
  appInfo: AppInfo;
  now: () => Date;
}

/** Builds the main-process implementation of every IPC contract. */
export function createIpcHandlers(deps: HandlerDependencies): IpcHandlers {
  return {
    app: {
      getInfo: () => deps.appInfo,
      ping: (request) => ({ message: request.message, receivedAt: deps.now().toISOString() }),
    },
  };
}
