import type { EntityType } from '@raml-kql/pack-schema/extension-manifest';
import type { z } from 'zod';

import type { AccountsSnapshot, AddAccountRequest } from '../../shared/auth/models';
import type {
  KeybindingsSnapshot,
  SettingsSnapshot,
  UserThemesSnapshot,
} from '../../shared/config/config-snapshots';
import type { CrashReport, PendingCrashes } from '../../shared/crash/models';
import { AppError } from '../../shared/errors';
import type {
  EnrichmentResultData,
  ExtensionsSnapshot,
  InstallResult,
} from '../../shared/extensions/models';
import type {
  AppInfo,
  AuditVerification,
  IpcHandlers,
  SettingsUpdateRequest,
} from '../../shared/ipc/contracts';
import type { LayoutState } from '../../shared/layout/layout-state';
import type { MenuBarModel, MenuRole } from '../../shared/menus/menu-model';
import type { NetworkActivity } from '../../shared/network/activity';
import type {
  ImportResult,
  PackQueryData,
  PackQueryRef,
  PacksSnapshot,
  SourcePreview,
  UpdatePreview,
} from '../../shared/packs/models';
import type { QueryFile, QueryNode, SaveQueryRequest } from '../../shared/queries/models';
import type { HistoryEntry } from '../../shared/query/history';
import type { QueryRunRequest, RerunRequest, RunSnapshot } from '../../shared/query/models';
import type { TabsState } from '../../shared/query/tabs';
import type { ExportRequest, ExportResult } from '../../shared/results/export';
import type {
  AggregateRequestSchema,
  ChartData,
  ChartDataRequestSchema,
  GroupResultSchema,
  PortalQueryRequest,
  ViewPageRequestSchema,
} from '../../shared/results/requests';
import type { ViewPage } from '../../shared/results/view';
import type { MergedSchema, SchemaRequest } from '../../shared/schema/models';
import type { UpdateState } from '../../shared/update/models';
import type { Group, GroupsSnapshot } from '../../shared/workspaces/groups';
import type { Inventory, TenantUpdate, WorkspaceUpdate } from '../../shared/workspaces/models';
import { isAllowedExternalUrl } from '../security/navigation';

type ViewPageRequestParsed = z.output<typeof ViewPageRequestSchema>;
type GroupResultData = z.output<typeof GroupResultSchema>;

/** Operations on the main window, provided by index.ts (keeps handlers free of Electron). */
export interface WindowOperations {
  setTitleBarOverlay(colors: { color: string; symbolColor: string }): void;
  setMenu(model: MenuBarModel): void;
  runEditRole(role: MenuRole): void;
  toggleFullScreen(): void;
  toggleDevTools(): void;
  reload(): void;
  /** Returns the new zoom level. */
  zoom(action: 'in' | 'out' | 'reset'): number;
}

export interface HandlerDependencies {
  appInfo: AppInfo;
  now: () => Date;
  relaunch: (options: { demo: boolean }) => void;
  showAbout: () => void;
  networkActivity: () => NetworkActivity;
  update: {
    state(): UpdateState;
    check(): Promise<UpdateState>;
    install(): void;
  };
  crash: {
    pending(): Promise<PendingCrashes>;
    report(): Promise<CrashReport>;
    dismiss(): Promise<void>;
    reportError(message: string, stack: string | undefined): Promise<void>;
    openIssue(report: CrashReport): Promise<void>;
  };
  accounts: {
    snapshot(): AccountsSnapshot;
    addAccount(request: AddAccountRequest): Promise<AccountsSnapshot>;
    removeAccount(accountId: string): Promise<AccountsSnapshot>;
    reauthenticate(accountId: string, tenantId?: string): Promise<AccountsSnapshot>;
    refresh(accountId?: string): Promise<AccountsSnapshot>;
    setLabel(accountId: string, label: string | null): Promise<AccountsSnapshot>;
  };
  inventory: {
    snapshot(): Inventory;
    refresh(): Promise<Inventory>;
    updateWorkspaces(update: WorkspaceUpdate): Promise<Inventory>;
    updateTenant(update: TenantUpdate): Promise<Inventory>;
  };
  schema: { get(request: SchemaRequest): Promise<MergedSchema> };
  query: {
    run(request: QueryRunRequest): Promise<RunSnapshot>;
    cancel(runId: string): RunSnapshot | undefined;
    rerun(request: RerunRequest): Promise<RunSnapshot | undefined>;
    get(runId: string): RunSnapshot | undefined;
    deleteRun(runId: string): Promise<void>;
    deleteAll(): Promise<void>;
  };
  results: {
    view(request: ViewPageRequestParsed): Promise<ViewPage>;
    aggregate(request: z.output<typeof AggregateRequestSchema>): Promise<GroupResultData>;
    chartData(request: z.output<typeof ChartDataRequestSchema>): Promise<ChartData>;
    export(request: ExportRequest): Promise<ExportResult>;
    saveImage(format: 'png' | 'svg', data: string): Promise<ExportResult>;
  };
  links: { portalQuery(request: PortalQueryRequest): { url: string } };
  audit: { verify(): Promise<AuditVerification> };
  groups: {
    snapshot(): GroupsSnapshot;
    save(group: Group): Promise<GroupsSnapshot>;
    delete(id: string): Promise<GroupsSnapshot>;
  };
  settings: {
    current: SettingsSnapshot;
    update(request: SettingsUpdateRequest): Promise<SettingsSnapshot>;
  };
  keybindings: { current: KeybindingsSnapshot };
  userThemes: () => UserThemesSnapshot;
  layout: { read(): Promise<LayoutState>; write(state: LayoutState): Promise<void> };
  tabs: { read(): Promise<TabsState | undefined>; write(state: TabsState): Promise<void> };
  history: { list(): Promise<HistoryEntry[]>; clear(): Promise<void> };
  queries: {
    list(): Promise<QueryNode[]>;
    read(path: string): Promise<QueryFile>;
    save(request: SaveQueryRequest): Promise<QueryFile>;
    rename(path: string, name: string): Promise<QueryFile>;
    move(path: string, folder: string): Promise<string>;
    createFolder(path: string): Promise<void>;
    delete(path: string): Promise<void>;
    reveal(path: string | undefined): void;
  };
  packs: PacksOperations;
  extensions: ExtensionsOperations;
  window: WindowOperations;
  shell: {
    openConfigFile(file: 'settings' | 'keybindings'): Promise<void>;
    openConfigFolder(): Promise<void>;
    openExternal(url: string): Promise<void>;
    writeClipboard(text: string): Promise<void>;
    writeClipboardImage(dataUrl: string): Promise<void>;
  };
}

/** Query packs and their sources (spec 08). */
export interface PacksOperations {
  snapshot(): Promise<PacksSnapshot>;
  readQuery(ref: PackQueryRef): PackQueryData;
  previewGit(request: {
    url: string;
    ref?: string | undefined;
    token?: string | undefined;
  }): Promise<SourcePreview>;
  importFile(kind: 'file' | 'folder'): Promise<ImportResult>;
  add(previewId: string): Promise<PacksSnapshot>;
  cancelPreview(previewId: string): Promise<void>;
  remove(sourceId: string): Promise<PacksSnapshot>;
  checkUpdates(options: { sourceId?: string; force: boolean }): Promise<{
    checked: number;
    updates: number;
    errors: { label: string; message: string }[];
  }>;
  updatePreview(sourceId: string): Promise<UpdatePreview>;
  applyUpdate(sourceId: string, sha: string): Promise<PacksSnapshot>;
}

/** Extensions (spec 07). */
export interface ExtensionsOperations {
  snapshot(): Promise<ExtensionsSnapshot>;
  installFromFile(): Promise<InstallResult>;
  installFromGit(url: string): Promise<InstallResult>;
  checkUpdates(): Promise<{ updates: number; errors: string[] }>;
  update(id: string): Promise<InstallResult>;
  confirmInstall(previewId: string): Promise<ExtensionsSnapshot>;
  cancelInstall(previewId: string): void;
  uninstall(id: string): Promise<ExtensionsSnapshot>;
  setEnabled(id: string, enabled: boolean): Promise<ExtensionsSnapshot>;
  executeCommand(
    command: string,
    args: unknown[],
    runId?: string,
    fromResults?: boolean,
  ): Promise<unknown>;
  enrich(
    extensionId: string,
    enricherId: string,
    runId: string | undefined,
    entities: { type: EntityType; value: string }[],
  ): Promise<EnrichmentResultData[]>;
  resultsAccess(extensionId: string, runId: string | undefined, rows: number): Promise<boolean>;
  resolveView(viewId: string): Promise<void>;
  webviewMessage(viewId: string, message: unknown): Promise<void>;
  respond(requestId: number, value: unknown): void;
  revoke(id: string, permission?: string): Promise<ExtensionsSnapshot>;
  readme(id: string): Promise<string | undefined>;
}

/** Builds the main-process implementation of every IPC contract. */
export function createIpcHandlers(deps: HandlerDependencies): IpcHandlers {
  return {
    app: {
      getInfo: () => deps.appInfo,
      ping: (request) => ({ message: request.message, receivedAt: deps.now().toISOString() }),
      relaunch: (request) => {
        deps.relaunch(request);
      },
      showAbout: () => {
        deps.showAbout();
      },
      networkActivity: () => deps.networkActivity(),
    },
    update: {
      state: () => deps.update.state(),
      check: () => deps.update.check(),
      install: () => {
        deps.update.install();
      },
    },
    crash: {
      pending: () => deps.crash.pending(),
      report: () => deps.crash.report(),
      dismiss: async () => {
        await deps.crash.dismiss();
      },
      reportError: async ({ message, stack }) => {
        await deps.crash.reportError(message, stack);
      },
      openIssue: async (report) => {
        await deps.crash.openIssue(report);
      },
    },
    accounts: {
      get: () => deps.accounts.snapshot(),
      add: (request) => deps.accounts.addAccount(request),
      remove: ({ accountId }) => deps.accounts.removeAccount(accountId),
      reauthenticate: ({ accountId, tenantId }) =>
        deps.accounts.reauthenticate(accountId, tenantId),
      refresh: ({ accountId }) => deps.accounts.refresh(accountId),
      setLabel: ({ accountId, label }) => deps.accounts.setLabel(accountId, label),
    },
    inventory: {
      get: () => deps.inventory.snapshot(),
      refresh: () => deps.inventory.refresh(),
      updateWorkspaces: (update) => deps.inventory.updateWorkspaces(update),
      updateTenant: (update) => deps.inventory.updateTenant(update),
    },
    schema: {
      get: (request) => deps.schema.get(request),
    },
    query: {
      run: (request) => deps.query.run(request),
      cancel: ({ runId }) => deps.query.cancel(runId) ?? null,
      rerun: async (request) => (await deps.query.rerun(request)) ?? null,
      get: ({ runId }) => deps.query.get(runId) ?? null,
      delete: async ({ runId }) => {
        await deps.query.deleteRun(runId);
        return undefined;
      },
      deleteAll: async () => {
        await deps.query.deleteAll();
        return undefined;
      },
    },
    results: {
      view: (request) => deps.results.view(request),
      aggregate: (request) => deps.results.aggregate(request),
      chartData: (request) => deps.results.chartData(request),
      export: (request) => deps.results.export(request),
      saveImage: ({ format, data }) => deps.results.saveImage(format, data),
    },
    links: {
      portalQuery: (request) => {
        const { url } = deps.links.portalQuery(request);
        if (!isAllowedExternalUrl(url)) throw new Error('Unexpected portal URL');
        return { url };
      },
    },
    audit: {
      verify: () => deps.audit.verify(),
    },
    groups: {
      get: () => deps.groups.snapshot(),
      save: (group) => deps.groups.save(group),
      delete: ({ id }) => deps.groups.delete(id),
    },
    settings: {
      get: () => deps.settings.current,
      update: (request) => deps.settings.update(request),
    },
    keybindings: {
      get: () => deps.keybindings.current,
    },
    themes: {
      listUser: () => deps.userThemes(),
    },
    extensions: {
      list: () => deps.extensions.snapshot(),
      installFromFile: () => deps.extensions.installFromFile(),
      installFromGit: ({ url }) => deps.extensions.installFromGit(url),
      checkUpdates: () => deps.extensions.checkUpdates(),
      update: ({ id }) => deps.extensions.update(id),
      confirmInstall: ({ previewId }) => deps.extensions.confirmInstall(previewId),
      cancelInstall: ({ previewId }) => {
        deps.extensions.cancelInstall(previewId);
      },
      uninstall: ({ id }) => deps.extensions.uninstall(id),
      setEnabled: ({ id, enabled }) => deps.extensions.setEnabled(id, enabled),
      executeCommand: async ({ command, args, runId, fromResults }) => {
        const value = await deps.extensions.executeCommand(command, args, runId, fromResults);
        return value === undefined ? {} : { value: value as z.core.util.JSONType };
      },
      respond: ({ requestId, value }) => {
        deps.extensions.respond(requestId, value);
      },
      revoke: ({ id, permission }) => deps.extensions.revoke(id, permission),
      enrich: async ({ extensionId, enricherId, runId, entities }) => ({
        results: await deps.extensions.enrich(extensionId, enricherId, runId, entities),
      }),
      resultsAccess: async ({ extensionId, runId, rows }) => ({
        allowed: await deps.extensions.resultsAccess(extensionId, runId, rows),
      }),
      resolveView: async ({ viewId }) => {
        await deps.extensions.resolveView(viewId);
      },
      webviewMessage: async ({ viewId, message }) => {
        await deps.extensions.webviewMessage(viewId, message);
      },
      readme: async ({ id }) => {
        const readme = await deps.extensions.readme(id);
        return readme === undefined ? {} : { readme };
      },
    },
    packs: {
      list: () => deps.packs.snapshot(),
      readQuery: (ref) => deps.packs.readQuery(ref),
      previewGit: (request) => deps.packs.previewGit(request),
      importFile: ({ kind }) => deps.packs.importFile(kind),
      add: ({ previewId }) => deps.packs.add(previewId),
      cancelPreview: async ({ previewId }) => {
        await deps.packs.cancelPreview(previewId);
      },
      remove: ({ sourceId }) => deps.packs.remove(sourceId),
      checkUpdates: ({ sourceId, force }) =>
        deps.packs.checkUpdates({ ...(sourceId === undefined ? {} : { sourceId }), force }),
      updatePreview: ({ sourceId }) => deps.packs.updatePreview(sourceId),
      applyUpdate: ({ sourceId, sha }) => deps.packs.applyUpdate(sourceId, sha),
    },
    queries: {
      list: async () => ({ nodes: await deps.queries.list() }),
      read: ({ path }) => deps.queries.read(path),
      save: (request) => deps.queries.save(request),
      rename: ({ path, name }) => deps.queries.rename(path, name),
      move: async ({ path, folder }) => ({ path: await deps.queries.move(path, folder) }),
      createFolder: async ({ path }) => {
        await deps.queries.createFolder(path);
        return undefined;
      },
      delete: async ({ path }) => {
        await deps.queries.delete(path);
        return undefined;
      },
      reveal: ({ path }) => {
        deps.queries.reveal(path);
        return undefined;
      },
    },
    history: {
      list: async () => ({ entries: await deps.history.list() }),
      clear: async () => {
        await deps.history.clear();
        return undefined;
      },
    },
    tabs: {
      get: async () => (await deps.tabs.read()) ?? null,
      set: async (state) => {
        await deps.tabs.write(state);
        return undefined;
      },
    },
    layout: {
      get: () => deps.layout.read(),
      set: async (state) => {
        await deps.layout.write(state);
      },
    },
    window: {
      setTitleBarOverlay: (colors) => {
        deps.window.setTitleBarOverlay(colors);
      },
      setMenu: (model) => {
        deps.window.setMenu(model);
      },
      runEditRole: ({ role }) => {
        deps.window.runEditRole(role);
      },
      toggleFullScreen: () => {
        deps.window.toggleFullScreen();
      },
      toggleDevTools: () => {
        deps.window.toggleDevTools();
      },
      reload: () => {
        deps.window.reload();
      },
      zoom: ({ action }) => ({ level: deps.window.zoom(action) }),
    },
    shell: {
      openConfigFile: async ({ file }) => {
        await deps.shell.openConfigFile(file);
      },
      openConfigFolder: async () => {
        await deps.shell.openConfigFolder();
      },
      writeClipboard: async ({ text }) => {
        await deps.shell.writeClipboard(text);
      },
      writeClipboardImage: async ({ dataUrl }) => {
        await deps.shell.writeClipboardImage(dataUrl);
      },
      openExternal: async ({ url }) => {
        if (!isAllowedExternalUrl(url)) {
          throw new AppError({
            code: 'URL_NOT_ALLOWED',
            message: 'This link can’t be opened: it is not on the list of allowed sites.',
            retryable: false,
            source: 'main',
          });
        }
        await deps.shell.openExternal(url);
      },
    },
  };
}
