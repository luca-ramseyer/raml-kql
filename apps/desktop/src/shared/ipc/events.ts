import { z } from 'zod';

import { AccountsSnapshotSchema, DeviceCodePromptSchema } from '../auth/models';
import {
  KeybindingsSnapshotSchema,
  SettingsSnapshotSchema,
  UserThemesSnapshotSchema,
} from '../config/config-snapshots';
import { UiRequestEventSchema } from '../extensions/models';
import { RunSnapshotSchema } from '../query/models';
import { UpdateStateSchema } from '../update/models';
import { GroupsSnapshotSchema } from '../workspaces/groups';
import { InventorySchema } from '../workspaces/models';

/**
 * Events pushed from the main process to the workbench (the opposite direction of
 * `contracts.ts`). The preload validates every payload before handing it to a listener.
 */
export const ipcEvents = {
  /** settings.jsonc changed (on disk or through `settings.update`). */
  'settings.changed': SettingsSnapshotSchema,
  'keybindings.changed': KeybindingsSnapshotSchema,
  'themes.changed': UserThemesSnapshotSchema,
  /** A native menu item was clicked. */
  'menu.runCommand': z.object({ command: z.string().min(1).max(200) }),
  'window.fullScreenChanged': z.object({ fullScreen: z.boolean() }),
  'accounts.changed': AccountsSnapshotSchema,
  /** Device code sign-in started: show the code to the user. */
  'accounts.deviceCode': DeviceCodePromptSchema,
  'inventory.changed': InventorySchema,
  /** Discovery found workspaces it hadn't seen before ("5 new workspaces discovered — Review"). */
  'inventory.newWorkspaces': z.object({ count: z.number().int().positive() }),
  'groups.changed': GroupsSnapshotSchema,
  /** A query run progressed (workspace states, row counts). Never contains result rows. */
  'query.runChanged': RunSnapshotSchema,
  /** A run was added to the history, or it was cleared. */
  'history.changed': z.object({}),
  /** Files in My Queries changed (in the app or on disk). */
  'queries.changed': z.object({}),
  /** Pack sources, installed packs or available updates changed. */
  'packs.changed': z.object({}),
  /** Extensions were installed, removed, enabled, started, or grants changed. */
  'extensions.changed': z.object({}),
  /** An extension needs the workbench (a message, a prompt, the editor); answer with `extensions.respond`. */
  'extensions.uiRequest': UiRequestEventSchema,
  /** The auto-updater changed state (downloading, ready to install, failed). */
  'update.changed': UpdateStateSchema,
  /** An extension posted a message to its sidebar view. */
  'extensions.webviewPost': z.object({ viewId: z.string(), message: z.json() }),
} as const satisfies Record<string, z.ZodType>;

export type IpcEvents = typeof ipcEvents;
export type IpcEventName = keyof IpcEvents;
export type IpcEventPayload<E extends IpcEventName> = z.output<IpcEvents[E]>;

/** Electron channel name for an event (namespaced so it can't collide with invoke channels). */
export function eventChannel(name: IpcEventName): string {
  return `event:${name}`;
}

export interface RamlKqlEventsApi {
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<E extends IpcEventName>(name: E, listener: (payload: IpcEventPayload<E>) => void): () => void;
}
