import { z } from 'zod';

import { AccountsSnapshotSchema, AddAccountRequestSchema, GuidSchema } from '../auth/models';
import {
  KeybindingsSnapshotSchema,
  SettingsSnapshotSchema,
  UserThemesSnapshotSchema,
} from '../config/config-snapshots';
import { CrashReportSchema, PendingCrashesSchema } from '../crash/models';
import {
  EnrichmentResultSchema,
  EntitySchema,
  ExtensionIdSchema,
  ExtensionsSnapshotSchema,
  InstallResultSchema,
  UiResponseSchema,
} from '../extensions/models';
import { LayoutStateSchema } from '../layout/layout-state';
import { MenuBarModelSchema, MenuRoleSchema } from '../menus/menu-model';
import { NetworkActivitySchema } from '../network/activity';
import {
  GIT_SHA,
  ImportResultSchema,
  PackQueryRefSchema,
  PackQuerySchema,
  PacksSnapshotSchema,
  PreviewGitRequestSchema,
  SourcePreviewSchema,
  SourceRefSchema,
  UpdatePreviewSchema,
} from '../packs/models';
import {
  QueriesSnapshotSchema,
  QueryFileSchema,
  QueryPathSchema,
  SaveQueryRequestSchema,
} from '../queries/models';
import { HistorySnapshotSchema } from '../query/history';
import { QueryRunRequestSchema, RerunRequestSchema, RunSnapshotSchema } from '../query/models';
import { TabsStateSchema } from '../query/tabs';
import { ExportRequestSchema, ExportResultSchema } from '../results/export';
import {
  AggregateRequestSchema,
  ChartDataRequestSchema,
  ChartDataSchema,
  GroupResultSchema,
  PortalQueryRequestSchema,
  ViewPageRequestSchema,
} from '../results/requests';
import { ViewPageSchema } from '../results/view';
import { MergedSchemaSchema, SchemaRequestSchema } from '../schema/models';
import { GroupSchema, GroupsSnapshotSchema } from '../workspaces/groups';
import { InventorySchema, TenantUpdateSchema, WorkspaceUpdateSchema } from '../workspaces/models';

import { defineChannel, type AnyChannel, type IpcResult } from './channel';
import type { RamlKqlEventsApi } from './events';

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const RunIdSchema = z.object({ runId: z.string().min(1).max(100) }).strict();

export const AuditVerificationSchema = z.object({
  ok: z.boolean(),
  entries: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  problem: z.object({ file: z.string(), line: z.number().int(), reason: z.string() }).optional(),
});
export type AuditVerification = z.infer<typeof AuditVerificationSchema>;

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
    /** Hosts contacted this session (spec 10, "Developer: Show Network Activity"). */
    networkActivity: defineChannel('app:networkActivity', z.undefined(), NetworkActivitySchema),
  },
  crash: {
    /** Crashes since the user last looked (empty unless `crashReporting.mode` is "ask"). */
    pending: defineChannel('crash:pending', z.undefined(), PendingCrashesSchema),
    /** The sanitized issue text for the pending crashes. */
    report: defineChannel('crash:report', z.undefined(), CrashReportSchema),
    /** Don't offer the current crashes again. */
    dismiss: defineChannel('crash:dismiss', z.undefined(), z.undefined()),
    /** An error in the workbench (sanitized and recorded in main). */
    reportError: defineChannel(
      'crash:reportError',
      z
        .object({ message: z.string().max(4000), stack: z.string().max(20_000).optional() })
        .strict(),
      z.undefined(),
    ),
    /** Open a prefilled GitHub issue (sanitized again in main); the user submits it. */
    openIssue: defineChannel('crash:openIssue', CrashReportSchema.strict(), z.undefined()),
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
  query: {
    /** Start a fan-out run (spec 04). Results are fetched with `results.page`. */
    run: defineChannel('query:run', QueryRunRequestSchema, RunSnapshotSchema),
    cancel: defineChannel('query:cancel', RunIdSchema, RunSnapshotSchema.nullable()),
    rerun: defineChannel('query:rerun', RerunRequestSchema, RunSnapshotSchema.nullable()),
    get: defineChannel('query:get', RunIdSchema, RunSnapshotSchema.nullable()),
    /** Free a run's results (tab closed). */
    delete: defineChannel('query:delete', RunIdSchema, z.undefined()),
    /** "Clear all results". */
    deleteAll: defineChannel('query:deleteAll', z.undefined(), z.undefined()),
  },
  results: {
    /** A page of a sorted/filtered/searched view (spec 06); rows never leave main otherwise. */
    view: defineChannel('results:view', ViewPageRequestSchema, ViewPageSchema),
    /** Group-by over a view ("Grouped view"). */
    aggregate: defineChannel('results:aggregate', AggregateRequestSchema, GroupResultSchema),
    /** Selected columns of a view, for charts. */
    chartData: defineChannel('results:chartData', ChartDataRequestSchema, ChartDataSchema),
    /** Export to a file (native save dialog) or the clipboard. */
    export: defineChannel('results:export', ExportRequestSchema, ExportResultSchema),
    /** Save a chart as PNG or SVG (native save dialog). */
    saveImage: defineChannel(
      'results:saveImage',
      z.discriminatedUnion('format', [
        z
          .object({
            format: z.literal('png'),
            data: z
              .string()
              .max(30_000_000)
              .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
          })
          .strict(),
        z
          .object({ format: z.literal('svg'), data: z.string().max(30_000_000).startsWith('<svg') })
          .strict(),
      ]),
      ExportResultSchema,
    ),
  },
  links: {
    /** "Open query in Azure Portal Logs" URL for a workspace. */
    portalQuery: defineChannel(
      'links:portalQuery',
      PortalQueryRequestSchema,
      z.object({ url: z.url().max(200_000) }),
    ),
  },
  audit: {
    /** "Audit: Verify Log Integrity". */
    verify: defineChannel('audit:verify', z.undefined(), AuditVerificationSchema),
  },
  schema: {
    /** Merged schema (tables, columns, functions; never data) for a set of workspaces. */
    get: defineChannel('schema:get', SchemaRequestSchema.strict(), MergedSchemaSchema),
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
  queries: {
    /** My Queries tree (folders and `.kql` files). */
    list: defineChannel('queries:list', z.undefined(), QueriesSnapshotSchema),
    read: defineChannel(
      'queries:read',
      z.object({ path: QueryPathSchema }).strict(),
      QueryFileSchema,
    ),
    save: defineChannel('queries:save', SaveQueryRequestSchema, QueryFileSchema),
    rename: defineChannel(
      'queries:rename',
      z.object({ path: QueryPathSchema, name: z.string().min(1).max(300) }).strict(),
      QueryFileSchema,
    ),
    move: defineChannel(
      'queries:move',
      z
        .object({ path: QueryPathSchema, folder: z.union([QueryPathSchema, z.literal('')]) })
        .strict(),
      z.object({ path: z.string() }),
    ),
    createFolder: defineChannel(
      'queries:createFolder',
      z.object({ path: QueryPathSchema }).strict(),
      z.undefined(),
    ),
    /** Moves to the OS trash. */
    delete: defineChannel(
      'queries:delete',
      z.object({ path: QueryPathSchema }).strict(),
      z.undefined(),
    ),
    reveal: defineChannel(
      'queries:reveal',
      z.object({ path: QueryPathSchema.optional() }).strict(),
      z.undefined(),
    ),
  },
  packs: {
    /** Pack sources and installed packs (spec 08). */
    list: defineChannel('packs:list', z.undefined(), PacksSnapshotSchema),
    /** A pack query with its body. */
    readQuery: defineChannel('packs:readQuery', PackQueryRefSchema, PackQuerySchema),
    /** Clone a git source into a temporary folder and describe it (nothing is added yet). */
    previewGit: defineChannel('packs:previewGit', PreviewGitRequestSchema, SourcePreviewSchema),
    /**
     * Pick files in the OS dialog: a `.rkqlpack` zip or loose `.kql` files (which become My
     * Queries), or a pack folder.
     */
    importFile: defineChannel(
      'packs:importFile',
      z.object({ kind: z.enum(['file', 'folder']) }).strict(),
      ImportResultSchema,
    ),
    add: defineChannel(
      'packs:add',
      z.object({ previewId: z.string().min(1).max(100) }).strict(),
      PacksSnapshotSchema,
    ),
    cancelPreview: defineChannel(
      'packs:cancelPreview',
      z.object({ previewId: z.string().min(1).max(100) }).strict(),
      z.undefined(),
    ),
    remove: defineChannel('packs:remove', SourceRefSchema, PacksSnapshotSchema),
    /** Check git sources for newer commits (`force` skips the 24-hour throttle). */
    checkUpdates: defineChannel(
      'packs:checkUpdates',
      z.object({ sourceId: z.string().max(100).optional(), force: z.boolean() }).strict(),
      z.object({
        checked: z.number().int(),
        updates: z.number().int(),
        errors: z.array(z.object({ label: z.string(), message: z.string() })),
      }),
    ),
    updatePreview: defineChannel('packs:updatePreview', SourceRefSchema, UpdatePreviewSchema),
    applyUpdate: defineChannel(
      'packs:applyUpdate',
      z.object({ sourceId: z.string().max(100), sha: z.string().regex(GIT_SHA) }).strict(),
      PacksSnapshotSchema,
    ),
  },
  extensions: {
    /** Installed extensions and their grants (spec 07). */
    list: defineChannel('extensions:list', z.undefined(), ExtensionsSnapshotSchema),
    /** Pick a `.rkqlx` in the OS dialog and describe it (nothing is installed yet). */
    installFromFile: defineChannel(
      'extensions:installFromFile',
      z.undefined(),
      InstallResultSchema,
    ),
    /** Newest compatible release of a git repository (a release asset or a built tag). */
    installFromGit: defineChannel(
      'extensions:installFromGit',
      z.object({ url: z.string().min(1).max(2000) }).strict(),
      InstallResultSchema,
    ),
    /** Look for newer releases of git-installed extensions. */
    checkUpdates: defineChannel(
      'extensions:checkUpdates',
      z.undefined(),
      z.object({ updates: z.number().int(), errors: z.array(z.string()) }),
    ),
    /** Describe the update of an extension (with its permission diff) before applying it. */
    update: defineChannel(
      'extensions:update',
      z.object({ id: ExtensionIdSchema }).strict(),
      InstallResultSchema,
    ),
    confirmInstall: defineChannel(
      'extensions:confirmInstall',
      z.object({ previewId: z.string().min(1).max(100) }).strict(),
      ExtensionsSnapshotSchema,
    ),
    cancelInstall: defineChannel(
      'extensions:cancelInstall',
      z.object({ previewId: z.string().min(1).max(100) }).strict(),
      z.undefined(),
    ),
    uninstall: defineChannel(
      'extensions:uninstall',
      z.object({ id: ExtensionIdSchema }).strict(),
      ExtensionsSnapshotSchema,
    ),
    setEnabled: defineChannel(
      'extensions:setEnabled',
      z.object({ id: ExtensionIdSchema, enabled: z.boolean() }).strict(),
      ExtensionsSnapshotSchema,
    ),
    /** Run a contributed command; `runId` is the active tab's query run (grant scope). */
    executeCommand: defineChannel(
      'extensions:executeCommand',
      z
        .object({
          command: z.string().min(1).max(200),
          args: z.array(z.json()).max(20),
          runId: z.string().max(100).optional(),
          /** From a result cell's menu: the arguments are result values (`results.readSelection`). */
          fromResults: z.boolean().optional(),
        })
        .strict(),
      z.object({ value: z.json().optional() }),
    ),
    /** Enrich result values with an extension's enricher (asks for permission first). */
    enrich: defineChannel(
      'extensions:enrich',
      z
        .object({
          extensionId: ExtensionIdSchema,
          enricherId: z.string().max(100),
          runId: z.string().max(100).optional(),
          entities: z.array(EntitySchema).min(1).max(500),
        })
        .strict(),
      z.object({ results: z.array(EnrichmentResultSchema) }),
    ),
    /** A result renderer asks to read the active result (`results.read`). */
    resultsAccess: defineChannel(
      'extensions:resultsAccess',
      z
        .object({
          extensionId: ExtensionIdSchema,
          runId: z.string().max(100).optional(),
          rows: z.number().int().nonnegative(),
        })
        .strict(),
      z.object({ allowed: z.boolean() }),
    ),
    /** A contributed sidebar view became visible. */
    resolveView: defineChannel(
      'extensions:resolveView',
      z.object({ viewId: z.string().max(200) }).strict(),
      z.undefined(),
    ),
    /** A message from a view's UI to its extension. */
    webviewMessage: defineChannel(
      'extensions:webviewMessage',
      z.object({ viewId: z.string().max(200), message: z.json() }).strict(),
      z.undefined(),
    ),
    /** The workbench's answer to an `extensions.uiRequest` event. */
    respond: defineChannel('extensions:respond', UiResponseSchema, z.undefined()),
    revoke: defineChannel(
      'extensions:revoke',
      z.object({ id: ExtensionIdSchema, permission: z.string().max(300).optional() }).strict(),
      ExtensionsSnapshotSchema,
    ),
    readme: defineChannel(
      'extensions:readme',
      z.object({ id: ExtensionIdSchema }).strict(),
      z.object({ readme: z.string().optional() }),
    ),
  },
  history: {
    list: defineChannel('history:list', z.undefined(), HistorySnapshotSchema),
    clear: defineChannel('history:clear', z.undefined(), z.undefined()),
  },
  tabs: {
    /** Tabs of the last session (null on first run). */
    get: defineChannel('tabs:get', z.undefined(), TabsStateSchema.nullable()),
    set: defineChannel('tabs:set', TabsStateSchema, z.undefined()),
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
      z.object({ text: z.string().max(20_000_000) }).strict(),
      z.undefined(),
    ),
    /** Copy a chart as an image (PNG data URL from ECharts). */
    writeClipboardImage: defineChannel(
      'shell:writeClipboardImage',
      z
        .object({
          dataUrl: z
            .string()
            .max(30_000_000)
            .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
        })
        .strict(),
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
