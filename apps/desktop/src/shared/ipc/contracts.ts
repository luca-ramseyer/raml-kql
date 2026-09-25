import { z } from 'zod';

import { AccountsSnapshotSchema, AddAccountRequestSchema, GuidSchema } from '../auth/models';
import {
  KeybindingsSnapshotSchema,
  SettingsSnapshotSchema,
  UserThemesSnapshotSchema,
} from '../config/config-snapshots';
import { LayoutStateSchema } from '../layout/layout-state';
import { MenuBarModelSchema, MenuRoleSchema } from '../menus/menu-model';
import { GroupSchema, GroupsSnapshotSchema } from '../workspaces/groups';
import { InventorySchema, TenantUpdateSchema, WorkspaceUpdateSchema } from '../workspaces/models';

import { defineChannel, type AnyChannel, type IpcResult } from './channel';
import type { RamlKqlEventsApi } from './events';

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  electronVersion: z.string(),
  /** True when running with `--demo` / `RAML_KQL_DEMO=1` (fake data, no network). */
  demoMode: z.boolean(),
  /** True for `pnpm dev` (unpackaged) builds. */
  isDevelopment: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const PingRequestSchema = z.object({ message: z.string().max(1024) }).strict();
export const PingResponseSchema = z.object({ message: z.string(), receivedAt: z.iso.datetime() });

export const SettingsUpdateRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), key: z.string().min(1).max(200), value: z.json() }).strict(),
  z.object({ action: z.literal('reset'), key: z.string().min(1).max(200) }).strict(),
]);
export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequestSchema>;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------------------------------------------------------------------------------------------
// Contract table: namespace -> method -> channel.
// The preload generates `window.ramlKql.<namespace>.<method>()` from this table and the main
// process must register a handler for every entry (enforced by the type of `IpcHandlers`).
// ---------------------------------------------------------------------------------------------

export const ipcContracts = {
  app: {
    /** Static information about the running app. */
    getInfo: defineChannel('app:getInfo', z.undefined(), AppInfoSchema),
    /** Diagnostic round trip to the main process. */
    ping: defineChannel('app:ping', PingRequestSchema, PingResponseSchema),
    /** Restart the app, switching demo mode on or off. */
    relaunch: defineChannel(
      'app:relaunch',
      z.object({ demo: z.boolean() }).strict(),
      z.undefined(),
    ),
    /** Native "About" dialog. */
    showAbout: defineChannel('app:showAbout', z.undefined(), z.undefined()),
  },
  accounts: {
    /** Accounts and tenants. Never contains tokens. */
    get: defineChannel('accounts:get', z.undefined(), AccountsSnapshotSchema),
    /** Interactive sign-in (system browser or device code). Resolves when finished. */
    add: defineChannel('accounts:add', AddAccountRequestSchema, AccountsSnapshotSchema),
    remove: defineChannel(
      'accounts:remove',
      z.object({ accountId: z.string().min(1).max(300) }).strict(),
      AccountsSnapshotSchema,
    ),
    /** Sign in again, for the home tenant or one tenant. */
    reauthenticate: defineChannel(
      'accounts:reauthenticate',
      z.object({ accountId: z.string().min(1).max(300), tenantId: GuidSchema.optional() }).strict(),
      AccountsSnapshotSchema,
    ),
    refresh: defineChannel(
      'accounts:refresh',
      z.object({ accountId: z.string().min(1).max(300).optional() }).strict(),
      AccountsSnapshotSchema,
    ),
    setLabel: defineChannel(
      'accounts:setLabel',
      z
        .object({ accountId: z.string().min(1).max(300), label: z.string().max(200).nullable() })
        .strict(),
      AccountsSnapshotSchema,
    ),
  },
  inventory: {
    /** Discovered workspaces and tenants with the user's preferences applied. Metadata only. */
    get: defineChannel('inventory:get', z.undefined(), InventorySchema),
    /** Run discovery now ("Refresh Workspaces"). Resolves when it finishes. */
    refresh: defineChannel('inventory:refresh', z.undefined(), InventorySchema),
    updateWorkspaces: defineChannel(
      'inventory:updateWorkspaces',
      WorkspaceUpdateSchema,
      InventorySchema,
    ),
    updateTenant: defineChannel('inventory:updateTenant', TenantUpdateSchema, InventorySchema),
  },
  groups: {
    get: defineChannel('groups:get', z.undefined(), GroupsSnapshotSchema),
    save: defineChannel('groups:save', GroupSchema, GroupsSnapshotSchema),
    delete: defineChannel(
      'groups:delete',
      z.object({ id: z.string().min(1).max(100) }).strict(),
      GroupsSnapshotSchema,
    ),
  },
  settings: {
    get: defineChannel('settings:get', z.undefined(), SettingsSnapshotSchema),
    /** Write one key to settings.jsonc, preserving the user's comments and formatting. */
    update: defineChannel('settings:update', SettingsUpdateRequestSchema, SettingsSnapshotSchema),
  },
  keybindings: {
    get: defineChannel('keybindings:get', z.undefined(), KeybindingsSnapshotSchema),
  },
  themes: {
    /** Colour themes from `<config>/themes/`. Built-in themes ship with the renderer. */
    listUser: defineChannel('themes:listUser', z.undefined(), UserThemesSnapshotSchema),
  },
  layout: {
    get: defineChannel('layout:get', z.undefined(), LayoutStateSchema),
    set: defineChannel('layout:set', LayoutStateSchema, z.undefined()),
  },
  window: {
    /** Colours of the native window controls (Windows/Linux title bar overlay). */
    setTitleBarOverlay: defineChannel(
      'window:setTitleBarOverlay',
      z.object({ color: HexColorSchema, symbolColor: HexColorSchema }).strict(),
      z.undefined(),
    ),
    /** Native application menu (macOS). */
    setMenu: defineChannel('window:setMenu', MenuBarModelSchema, z.undefined()),
    /** Clipboard/undo actions for the custom menu bar (Windows/Linux). */
    runEditRole: defineChannel(
      'window:runEditRole',
      z.object({ role: MenuRoleSchema }).strict(),
      z.undefined(),
    ),
    toggleFullScreen: defineChannel('window:toggleFullScreen', z.undefined(), z.undefined()),
    toggleDevTools: defineChannel('window:toggleDevTools', z.undefined(), z.undefined()),
    reload: defineChannel('window:reload', z.undefined(), z.undefined()),
    zoom: defineChannel(
      'window:zoom',
      z.object({ action: z.enum(['in', 'out', 'reset']) }).strict(),
      z.object({ level: z.number() }),
    ),
  },
  shell: {
    /** Open a config file in the OS default editor (until the in-app JSON editor exists). */
    openConfigFile: defineChannel(
      'shell:openConfigFile',
      z.object({ file: z.enum(['settings', 'keybindings']) }).strict(),
      z.undefined(),
    ),
    openConfigFolder: defineChannel('shell:openConfigFolder', z.undefined(), z.undefined()),
    /** Copy text to the clipboard (the renderer's web clipboard permission is denied). */
    writeClipboard: defineChannel(
      'shell:writeClipboard',
      z.object({ text: z.string().max(100_000) }).strict(),
      z.undefined(),
    ),
    /** Open an allowlisted https URL in the OS browser. */
    openExternal: defineChannel(
      'shell:openExternal',
      z.object({ url: z.url().max(2000) }).strict(),
      z.undefined(),
    ),
  },
} as const satisfies Record<string, Record<string, AnyChannel>>;

export type IpcContracts = typeof ipcContracts;

type RequestOf<C> = C extends { request: infer R extends z.ZodType } ? z.input<R> : never;
type ResponseOf<C> = C extends { response: infer R extends z.ZodType } ? z.output<R> : never;
type ParsedRequestOf<C> = C extends { request: infer R extends z.ZodType } ? z.output<R> : never;
type ResponseInputOf<C> = C extends { response: infer R extends z.ZodType } ? z.input<R> : never;

/** Methods whose request schema is `z.undefined()` take no argument. */
type ApiMethod<C> = [RequestOf<C>] extends [undefined]
  ? () => Promise<IpcResult<ResponseOf<C>>>
  : (request: RequestOf<C>) => Promise<IpcResult<ResponseOf<C>>>;

/** Shape of `window.ramlKql`, derived from the contract table and the event table. */
export type RamlKqlApi = {
  readonly [NS in keyof IpcContracts]: {
    readonly [M in keyof IpcContracts[NS]]: ApiMethod<IpcContracts[NS][M]>;
  };
} & { readonly events: RamlKqlEventsApi };

/** Context passed to every main-process handler. */
export interface IpcHandlerContext {
  /** URL of the frame that sent the request (already verified as trusted). */
  readonly senderUrl: string;
}

/** The main process must implement exactly one handler per contract entry. */
export type IpcHandlers = {
  readonly [NS in keyof IpcContracts]: {
    readonly [M in keyof IpcContracts[NS]]: (
      request: ParsedRequestOf<IpcContracts[NS][M]>,
      context: IpcHandlerContext,
    ) => ResponseInputOf<IpcContracts[NS][M]> | Promise<ResponseInputOf<IpcContracts[NS][M]>>;
  };
};

/** Flatten the contract table for code that needs to iterate over every channel. */
export function listChannels(
  contracts: Record<string, Record<string, AnyChannel>> = ipcContracts,
): { namespace: string; method: string; channel: AnyChannel }[] {
  return Object.entries(contracts).flatMap(([namespace, methods]) =>
    Object.entries(methods).map(([method, channel]) => ({ namespace, method, channel })),
  );
}
