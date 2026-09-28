import {
  eventChannel,
  ipcEvents,
  type IpcEventName,
  type IpcEventPayload,
} from '../../shared/ipc/events';

/** The subset of Electron's `WebContents` needed to push events. */
export interface EventTarget {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/** Send validated events to the workbench windows. */
export function createEventSender(getTargets: () => readonly EventTarget[]) {
  return function emit<E extends IpcEventName>(name: E, payload: IpcEventPayload<E>): void {
    // Validate on the way out too: a main-process bug must not push malformed data.
    const data: unknown = ipcEvents[name].parse(payload);
    for (const target of getTargets()) {
      if (!target.isDestroyed()) target.send(eventChannel(name), data);
    }
  };
}
export type EmitEvent = ReturnType<typeof createEventSender>;
