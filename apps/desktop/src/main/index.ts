/**
 * Main-process entry point. Keep this file thin: it only wires Electron to the testable
 * modules next to it. Anything with logic belongs in its own module with a unit test.
 */
import { watch } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir, release } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import type { z } from 'zod';

import type { QueryRunRequest, RerunRequest } from '../shared/query/models';
import { buildWorkbenchCsp } from '../shared/security/csp';
import {
  defaultSettingValues,
  getSettingDefinition,
  type SettingKey,
  type SettingValue,
} from '../shared/settings/registry';
import { accessPathKey } from '../shared/workspaces/models';

import { resolveAppMode } from './app-mode';
import { AuditLog } from './audit/audit-log';
import { JsoncAccountsConfig, MemoryAccountsConfig } from './auth/accounts-config';
import { AuthService, type AuthProviders } from './auth/auth-service';
import { AzureCliAuthProvider } from './auth/azure-cli-provider';
import { PUBLIC_CLOUD } from './auth/cloud';
import { DemoAuthProvider } from './auth/demo-provider';
import { EncryptedFileCachePlugin, resolveTokenPersistence } from './auth/encrypted-cache-plugin';
import { MsalAuthProvider } from './auth/msal-provider';
import { listTenants } from './azure/arm-tenants';
import { AzureHttp } from './azure/azure-http';
import { fetchWorkspaceMetadata } from './azure/log-analytics-metadata';
import { executeLogAnalyticsQuery } from './azure/log-analytics-query';
import {
  DISCOVERY_QUERIES,
  hasSentinelOnboarding,
  queryResourceGraph,
} from './azure/resource-graph';
import { configPaths, ensureConfigDir, resolveConfigDir } from './config/config-dir';
import { watchDirectory } from './config/config-watcher';
import { JsoncGroupsStore, MemoryGroupsStore } from './config/groups-config';
import { JsoncListStore } from './config/jsonc-list-store';
import { JsoncWorkspacesConfig, MemoryWorkspacesConfig } from './config/workspaces-config';
import { CrashService } from './crash/crash-service';
import { CrashStore } from './crash/crash-store';
import { parseDsn, SentrySink } from './crash/sentry-sink';
import { DemoDataSource } from './demo/demo-data-source';
import {
  DEMO_EXTRA_TENANTS,
  DEMO_TENANT_NAMES,
  DEMO_WORKSPACES,
  demoDiscoveryRows,
  demoResourceId,
} from './demo/demo-inventory';
import { demoFetchSchema } from './demo/demo-schema';
import { DiscoveryService } from './discovery/discovery-service';
import { GroupsService } from './discovery/groups-service';
import { FileInventoryCache, MemoryInventoryCache } from './discovery/inventory-cache';
import { ExportService } from './export/export-service';
import { ExtensionHostWindow, extensionHostPreload } from './extensions/extension-host';
import { ExtensionManager, InstalledEntrySchema } from './extensions/extension-manager';
import { EXTENSION_LIMITS, extensionError, readExtensionZip } from './extensions/extension-package';
import { ExtensionSecrets, ExtensionStorage } from './extensions/extension-stores';
import {
  EXTENSION_UI_SCHEME,
  extensionUiCsp,
  resolveExtensionFile,
} from './extensions/extension-ui-protocol';
import { resolveGitExtension } from './extensions/git-install';
import {
  PermissionBroker,
  PersistedGrantSchema,
  type PromptAnswer,
} from './extensions/permission-broker';
import { UiBroker } from './extensions/ui-broker';
import { HistoryService } from './history/history-service';
import { createEventSender } from './ipc/events';
import {
  createIpcHandlers,
  type ExtensionsOperations,
  type WindowOperations,
} from './ipc/handlers';
import { registerIpcRouter } from './ipc/router';
import { KeybindingsService, NEW_KEYBINDINGS_FILE } from './keybindings/keybindings-service';
import { portalQueryUrl } from './links/portal';
import {
  NetworkActivityRecorder,
  recordNetwork,
  setNetworkRecorder,
} from './network/network-activity';
import { createPacksOperations } from './packs/packs-operations';
import { PacksService } from './packs/packs-service';
import { withParameters } from './packs/parameters';
import { JsoncSourcesStore } from './packs/sources-config';
import { APP_ENTRY_URL, APP_ORIGIN, APP_SCHEME, resolveAppFile } from './protocol/app-protocol';
import { QueriesService } from './queries/queries-service';
import { DataSourceRegistry, LOG_ANALYTICS_SOURCE } from './query/data-sources';
import { ENGINE_DEFAULTS } from './query/limits';
import { QueryEngine } from './query/query-engine';
import { Scheduler } from './query/scheduler';
import { ResultStore } from './results/result-store';
import { ResultViews } from './results/result-views';
import { FileSchemaCache, MemorySchemaCache } from './schema/schema-cache';
import { SchemaService } from './schema/schema-service';
import { CredentialStore } from './security/credential-store';
import { installNavigationGuards, isTrustedOrigin, originKey } from './security/navigation';
import { denyAllPermissions } from './security/permissions';
import { secureWebPreferences } from './security/web-preferences';
import { NEW_SETTINGS_FILE, SettingsService } from './settings/settings-service';
import { LayoutStore } from './state/layout-store';
import { TabsStore } from './state/tabs-store';
import { UserThemesService } from './themes/user-themes';
import { buildMacMenuTemplate } from './window/menu';
import { titleBarOptions } from './window/title-bar';

const APP_NAME = 'Raml KQL';

// electron-vite sets this only for `electron-vite dev`. Never honour it in packaged builds.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const devServerOrigin = devServerUrl === undefined ? undefined : originKey(devServerUrl);
const trustedOrigins = [APP_ORIGIN, ...(devServerOrigin === undefined ? [] : [devServerOrigin])];

const mode = resolveAppMode(process.argv, process.env);
const paths = configPaths(
  resolveConfigDir({
    argv: process.argv,
    env: process.env,
    platform: process.platform,
    homeDir: homedir(),
  }),
);

const settings = new SettingsService(paths.settingsFile);
/**
 * Every Azure request (ARM, Resource Graph, Log Analytics, MSAL) goes through Chromium's
 * network stack, so the OS proxy configuration applies (D-023).
 */
const azureHttp = new AzureHttp({
  fetch: (url, init) => net.fetch(url, init),
  appName: 'RamlKQL',
  appVersion: app.getVersion(),
});
const keybindings = new KeybindingsService(paths.keybindingsFile);
const userThemes = new UserThemesService(paths.themesDir);
const layoutStore = new LayoutStore(paths.layoutStateFile);
const tabsStore = new TabsStore(paths.tabsStateFile);

let mainWindow: BrowserWindow | undefined;
const emit = createEventSender(() => (mainWindow === undefined ? [] : [mainWindow.webContents]));

// Machine-local data (MSAL cache, session result cache). Overridable like VS Code's
// --user-data-dir, so tests and portable setups never touch the real profile. Before `ready`.
const userDataOverride = process.env['RAML_KQL_USER_DATA_DIR']?.trim();
if (
  userDataOverride !== undefined &&
  userDataOverride !== '' &&
  path.isAbsolute(userDataOverride)
) {
  app.setPath('userData', userDataOverride);
}

// Crash reporting (spec 10): native dumps stay local (never uploaded); JavaScript errors are
// sanitized into state/crashes/ and offered as a report on the next start.
const crashDir = path.join(paths.stateDir, 'crashes');
app.setPath('crashDumps', path.join(crashDir, 'dumps'));
crashReporter.start({ uploadToServer: false, compress: true });
let crashNames: () => string[] = () => [];
const sentryDsn = parseDsn(__RAML_KQL_SENTRY_DSN__);
const crashes = new CrashService({
  store: new CrashStore(crashDir),
  env: {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    os: `${process.platform} ${release()} ${process.arch}`,
  },
  sanitizeOptions: () => ({
    homeDir: homedir(),
    appDir: path.dirname(app.getAppPath()),
    names: crashNames(),
  }),
  mode: () => effective('crashReporting.mode'),
  sink:
    sentryDsn === undefined
      ? undefined
      : new SentrySink(sentryDsn, (url, init) => net.fetch(url, init)),
});
process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error.name);
  void crashes.capture('main', error);
});
process.on('unhandledRejection', (reason) => {
  void crashes.capture('main', reason);
});
app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason !== 'clean-exit') {
    void crashes.capture(
      'renderer-gone',
      `Renderer gone: ${details.reason} (exit code ${String(details.exitCode)})`,
    );
  }
});
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
    void crashes.capture(
      'child-gone',
      `${details.type} process gone: ${details.reason} (exit code ${String(details.exitCode)})`,
    );
  }
});
app.on('will-quit', () => {
  crashes.end();
});

// "Developer: Show Network Activity" (spec 10): hosts contacted this session.
const networkActivity = new NetworkActivityRecorder();
setNetworkRecorder(networkActivity);

// Must run before `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
  // Extension UI (views, result renderers) in sandboxed iframes (spec 07).
  { scheme: EXTENSION_UI_SCHEME, privileges: { standard: true, secure: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(APP_NAME);

  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    installNavigationGuards(contents, {
      trustedOrigins,
      openExternal: (url) => void shell.openExternal(url),
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  void app.whenReady().then(async () => {
    denyAllPermissions(session.defaultSession);
    registerAppProtocol();
    // Everything the app itself fetches (Azure, identity, release lookups) goes through here.
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        if (devServerOrigin === undefined || !details.url.startsWith(devServerOrigin)) {
          recordNetwork(details.url, 'app');
        }
        callback({});
      },
    );

    await ensureConfigDir(paths);
    await crashes.start();
    await Promise.all([settings.reload(), keybindings.reload(), userThemes.reload()]);
    settings.onDidChange((snapshot) => {
      emit('settings.changed', snapshot);
    });
    keybindings.onDidChange((snapshot) => {
      emit('keybindings.changed', snapshot);
    });
    userThemes.onDidChange((snapshot) => {
      emit('themes.changed', snapshot);
    });
    // Live reload (spec 09): external edits, e.g. a `git pull` in a dotfiles repo, apply at once.
    watchDirectory(paths.root, (file) => {
      if (file === undefined || file === 'settings.jsonc') void settings.reload();
      if (file === undefined || file === 'keybindings.jsonc') void keybindings.reload();
    });
    watchDirectory(paths.themesDir, () => void userThemes.reload());

    const auth = createAuthService();
    const discovery = createDiscoveryService(auth);
    // Names to scrub from crash reports: tenants, subscriptions, workspaces, accounts.
    crashNames = () => {
      const inventory = discovery.snapshot();
      return [
        ...inventory.tenants.flatMap((t) => [t.displayName, t.defaultDomain, t.alias]),
        ...inventory.workspaces.flatMap((w) => [
          w.name,
          w.subscriptionName,
          w.resourceGroup,
          w.alias,
        ]),
        ...auth.snapshot().accounts.flatMap((a) => [a.username, a.label]),
      ].filter((n): n is string => n !== undefined && n.length >= 3);
    };
    const groups = new GroupsService(
      mode.demo ? new MemoryGroupsStore(DEMO_GROUPS) : new JsoncGroupsStore(paths.groupsFile),
      (snapshot) => {
        emit('groups.changed', snapshot);
      },
    );
    const schema = createSchemaService(auth, discovery);
    const myQueries = new QueriesService({
      root: paths.queriesDir,
      trash: (target) => shell.trashItem(target),
      reveal: (target) => {
        shell.showItemInFolder(target);
      },
    });
    await mkdir(paths.queriesDir, { recursive: true }).catch(() => undefined);
    watchQueries(paths.queriesDir, () => {
      emit('queries.changed', {});
    });
    const queries = createQueryServices(auth, discovery);
    const packs = await createPacks(myQueries);
    const extensions = await createExtensions(queries.audit);
    await Promise.all([discovery.init(), groups.reload()]);
    void auth.init().then(() => {
      queries.trackSignIns();
    });
    void queries.audit.prune().catch(() => undefined);
    watchDirectory(paths.root, (file) => {
      if (file === undefined || file === 'workspaces.jsonc') void discovery.reloadConfig();
      if (file === undefined || file === 'groups.jsonc') void groups.reload();
      if (file === undefined || file === 'extensions.jsonc') {
        void extensions.manager.load().then(() => {
          emit('extensions.changed', {});
        });
      }
      if (file === undefined || file === 'permissions.jsonc') {
        void extensions.broker.reload().then(() => {
          emit('extensions.changed', {});
        });
      }
      if (file === undefined || file === 'sources.jsonc') {
        void packs.service.reload().then(() => {
          emit('packs.changed', {});
        });
      }
    });

    // macOS gets a native menu once the renderer sends its model; elsewhere the renderer
    // draws the menu bar itself, so there's no native menu at all.
    Menu.setApplicationMenu(null);

    registerIpcRouter({
      ipcMain,
      handlers: createIpcHandlers({
        appInfo: {
          name: APP_NAME,
          version: app.getVersion(),
          platform: process.platform as 'darwin' | 'win32' | 'linux',
          electronVersion: process.versions.electron,
          demoMode: mode.demo,
          isDevelopment: !app.isPackaged,
        },
        now: () => new Date(),
        relaunch: ({ demo }) => {
          const args = process.argv.slice(1).filter((arg) => arg !== '--demo');
          app.relaunch({ args: demo ? [...args, '--demo'] : args });
          app.exit(0);
        },
        showAbout,
        networkActivity: () => networkActivity.snapshot(),
        crash: {
          pending: () => crashes.pending(),
          report: () => crashes.report(),
          dismiss: () => crashes.dismiss(),
          reportError: async (message, stack) => {
            const error = new Error(message.replace(/^Error: /, ''));
            error.stack = stack ?? message;
            await crashes.capture('renderer', error);
          },
          openIssue: (report) => shell.openExternal(crashes.issueUrl(report)),
        },
        accounts: auth,
        inventory: discovery,
        schema,
        query: queries.query,
        results: {
          view: (request) => queries.views.page(request),
          aggregate: async (request) => {
            const result = await queries.views.aggregate(request);
            return { ...result, rows: result.rows as GroupRows };
          },
          chartData: (request) => queries.views.chartData(request),
          export: (request) => queries.exports.export(request),
          saveImage: (format, data) => queries.exports.saveImage(format, data),
        },
        links: { portalQuery: (request) => ({ url: portalQueryUrl(request) }) },
        audit: queries.audit,
        groups,
        settings,
        keybindings,
        userThemes: () => userThemes.current,
        layout: layoutStore,
        tabs: tabsStore,
        history: queries.history,
        queries: myQueries,
        packs: packs.operations,
        extensions: extensions.operations,
        window: windowOperations(),
        shell: {
          openConfigFile: async (file) => {
            const target = file === 'settings' ? paths.settingsFile : paths.keybindingsFile;
            await createIfMissing(
              target,
              file === 'settings' ? NEW_SETTINGS_FILE : NEW_KEYBINDINGS_FILE,
            );
            // Until the in-app JSON editor exists (Phase 4), use the OS default editor, or reveal
            // the file when no application is associated with .jsonc.
            const error = await shell.openPath(target);
            if (error !== '') shell.showItemInFolder(target);
          },
          openConfigFolder: async () => {
            await shell.openPath(paths.root);
          },
          openExternal: (url) => shell.openExternal(url),
          writeClipboard: (text) => clipboard.writeText(text),
          writeClipboardImage: async (dataUrl) => {
            const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
            await clipboard.write([
              new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
            ]);
          },
        },
      }),
      isTrustedSender: (url) => isTrustedOrigin(url, trustedOrigins),
      onInternalError: (channel) => {
        // Never log payloads here; they may contain query text or result data.
        console.error(`[ipc] internal error on ${channel}`);
      },
    });

    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      extensions.ui.cancelAll();
    });
  });
}

/**
 * The built-in Entra client ID, injected at build time from RAML_KQL_CLIENT_ID (see
 * electron.vite.config.ts and docs/guides/entra-app-registration.md). Not a secret.
 */
const BUILTIN_CLIENT_ID = /^[0-9a-f-]{36}$/i.test(__RAML_KQL_CLIENT_ID__)
  ? __RAML_KQL_CLIENT_ID__
  : undefined;

/** Sign-in pages may only open in the system browser, and only on the Entra authority host. */
async function openSignInPage(url: string): Promise<void> {
  if (new URL(url).origin !== new URL(PUBLIC_CLOUD.authorityHost).origin) {
    throw new Error('Refusing to open an unexpected sign-in URL.');
  }
  await shell.openExternal(url);
}

/** Demo groups: one of each kind, so the Targets group picker has something to show. */
const DEMO_GROUPS = [
  { id: 'all-sentinel', name: 'All Sentinel', type: 'dynamic' as const, match: { sentinel: true } },
  {
    id: 'lighthouse-customers',
    name: 'Lighthouse customers',
    type: 'dynamic' as const,
    match: { tenantIds: Object.values(DEMO_EXTRA_TENANTS).map((t) => t.tenantId) },
  },
  {
    id: 'on-call',
    name: 'On-call set',
    type: 'static' as const,
    workspaces: DEMO_WORKSPACES.filter((w) =>
      ['la-contoso-soc', 'la-woodgrove-sentinel'].includes(w.name),
    ).map(demoResourceId),
  },
];

/**
 * Discovery (spec 03): Resource Graph through net.fetch, or demo data. Runs again whenever the
 * set of signed-in (account, tenant) pairs changes, e.g. after adding an account or signing in
 * to a tenant that needed it.
 */
function createDiscoveryService(auth: AuthService): DiscoveryService {
  const cloud = PUBLIC_CLOUD;
  const discovery = new DiscoveryService({
    auth,
    source: mode.demo
      ? {
          query: (kind, { accountId, tenantId }) =>
            Promise.resolve(demoDiscoveryRows(kind, accountId, tenantId)),
          tenantNames: () => DEMO_TENANT_NAMES,
        }
      : {
          query: (kind, { token }) =>
            queryResourceGraph({
              cloud,
              token,
              query: DISCOVERY_QUERIES[kind],
              fetch: azureHttp.fetch,
            }),
          hasSentinel: (workspaceResourceId, token) =>
            hasSentinelOnboarding({
              cloud,
              token,
              workspaceResourceId,
              fetch: azureHttp.fetch,
            }),
        },
    config: mode.demo
      ? new MemoryWorkspacesConfig()
      : new JsoncWorkspacesConfig(paths.workspacesFile),
    cache: mode.demo ? new MemoryInventoryCache() : new FileInventoryCache(paths.inventoryFile),
    newWorkspaceDefault: () =>
      settings.current.values['workspaces.newWorkspaceDefault'] === 'disabled'
        ? 'disabled'
        : 'enabled',
    onChange: (inventory) => {
      emit('inventory.changed', inventory);
    },
    onNewWorkspaces: (count) => {
      emit('inventory.newWorkspaces', { count });
    },
  });

  let signature = '';
  let timer: NodeJS.Timeout | undefined;
  auth.onDidChange((snapshot) => {
    discovery.syncTenants(snapshot);
    const next = snapshot.accounts
      .flatMap((a) => a.tenants.filter((t) => t.state === 'ok').map((t) => `${a.id}|${t.tenantId}`))
      .sort()
      .join(',');
    if (next === signature || snapshot.accounts.some((a) => a.refreshing)) return;
    signature = next;
    clearTimeout(timer);
    timer = setTimeout(() => void discovery.refresh(), 500);
  });
  return discovery;
}

/**
 * Workspace schemas for IntelliSense (spec 05): the Log Analytics metadata API through
 * net.fetch, cached per workspace on disk, or the demo schemas.
 */
function createSchemaService(auth: AuthService, discovery: DiscoveryService): SchemaService {
  const cloud = PUBLIC_CLOUD;
  return new SchemaService({
    workspace: (resourceId) =>
      discovery.snapshot().workspaces.find((w) => w.resourceId === resourceId),
    cache: mode.demo ? new MemorySchemaCache() : new FileSchemaCache(paths.schemaCacheDir),
    cacheHours: () => {
      const hours = settings.current.values['schema.cacheHours'];
      return typeof hours === 'number' ? hours : 24;
    },
    fetchSchema: mode.demo
      ? (workspace) => demoFetchSchema(workspace.resourceId)
      : async (workspace) => {
          // Preferred access path first, then the others (spec 03).
          const paths = [...workspace.paths].sort(
            (a, b) =>
              Number(accessPathKey(b) === workspace.preferredPath) -
              Number(accessPathKey(a) === workspace.preferredPath),
          );
          let lastError: unknown = new Error('No access path');
          for (const path of paths) {
            try {
              const token = await auth.getToken({
                accountId: path.accountId,
                tenantId: path.authorityTenantId,
                resource: 'logAnalytics',
              });
              return await fetchWorkspaceMetadata({
                cloud,
                token: token.token,
                customerId: workspace.customerId,
                fetch: azureHttp.fetch,
              });
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        },
  });
}

/** A setting's effective value (the user's valid value, else the default). */
/** Aggregated cells are copies of result cells, which are JSON values. */
type GroupRows = import('../shared/results/requests').ChartData['rows'];

function effective<K extends SettingKey>(key: K): SettingValue<K> {
  const parsed = getSettingDefinition(key)?.schema.safeParse(settings.current.values[key]);
  return parsed?.success === true ? (parsed.data as SettingValue<K>) : defaultSettingValues()[key];
}

/**
 * The query engine (spec 04): fan-out through AzureHttp to the Log Analytics Query API (or the
 * demo data source), the encrypted session result store and the audit log.
 */
/** Extensions (spec 07): the sandboxed host, the permission broker and the manager. */
async function createExtensions(audit: AuditLog) {
  const host = new ExtensionHostWindow({
    preload: extensionHostPreload(__dirname),
    rendererRoot: path.join(__dirname, '../renderer'),
    devServerUrl,
  });
  const ui = new UiBroker((event) => {
    if (mainWindow === undefined) return false;
    emit('extensions.uiRequest', event);
    return true;
  });
  let names = new Map<string, string>();
  const broker = new PermissionBroker({
    store: new JsoncListStore(
      paths.permissionsFile,
      'grants',
      PersistedGrantSchema,
      NEW_PERMISSIONS_FILE,
    ),
    prompt: async (request) =>
      (await ui.request({
        kind: 'permission',
        extension: names.get(request.extensionId) ?? request.extensionId,
        ...request,
      })) as PromptAnswer | undefined,
    audit: (event) => {
      void audit.append({ kind: 'extension', ...event });
    },
  });
  // Extension HTTP: a separate in-memory session, so no cookies or cache are shared with Azure.
  const netSession = session.fromPartition('raml-kql-extnet');
  const manager = new ExtensionManager({
    extensionsDir: paths.extensionsDir,
    store: new JsoncListStore(
      paths.extensionsFile,
      'extensions',
      InstalledEntrySchema,
      NEW_EXTENSIONS_FILE,
    ),
    broker,
    host: {
      start: async (id, code) => {
        const port = await host.start(id, code);
        return {
          postMessage: (message) => {
            port.postMessage(message);
          },
          on: (_event, listener) => {
            port.on('message', (event) => {
              listener({ data: event.data });
            });
          },
          start: () => {
            port.start();
          },
          close: () => {
            port.close();
          },
        };
      },
      stop: (id) => {
        host.stop(id);
      },
    },
    ui: (request) => ui.request(request),
    secrets: new ExtensionSecrets(
      path.join(app.getPath('userData'), 'extension-secrets.json'),
      safeStorage,
    ),
    storage: new ExtensionStorage(paths.extensionStorageDir),
    settingValue: (key) => settings.rawValue(key),
    fetch: (url, init) => netSession.fetch(url, init),
    writeClipboard: (text) => clipboard.writeText(text),
    env: () => ({
      appVersion: app.getVersion(),
      theme: nativeTheme.shouldUseHighContrastColors
        ? 'high-contrast'
        : nativeTheme.shouldUseDarkColors
          ? 'dark'
          : 'light',
      presentationMode: effective('privacy.aliasing.activeOnStartup'),
    }),
    audit: (event) => {
      void audit.append({ kind: 'extension', ...event });
    },
    onChange: () => {
      emit('extensions.changed', {});
      void userThemes.reload();
    },
    onError: (extensionId, error) => {
      void crashes.capture('extension', error, { extensionId });
    },
    postToWebview: (_extensionId, viewId, message) => {
      emit('extensions.webviewPost', { viewId, message: message as z.core.util.JSONType });
    },
  });
  userThemes.setExtensionThemes(() => manager.themes());
  settings.onDidChangeRaw((keys) => {
    manager.configurationChanged(keys);
  });
  protocol.handle(EXTENSION_UI_SCHEME, async (request) => {
    const url = new URL(request.url);
    const folder = manager.folderOf(url.hostname);
    const file = folder === undefined ? undefined : resolveExtensionFile(folder, url.pathname);
    if (file === undefined) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Security-Policy',
      extensionUiCsp(
        url.hostname,
        devServerOrigin === undefined ? [APP_ORIGIN] : [APP_ORIGIN, devServerOrigin],
      ),
    );
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
  // Release lookups (GitHub/GitLab APIs) are the app's own traffic, through the OS proxy.
  const appFetch = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init);
  const checkUpdates = async (): Promise<{ updates: number; errors: string[] }> => {
    let updates = 0;
    const errors: string[] = [];
    for (const source of manager.gitSources()) {
      try {
        const newer = await resolveGitExtension({
          url: source.url,
          fetch: appFetch,
          tempRoot: app.getPath('temp'),
          newerThan: source.version,
        });
        manager.setUpdate(
          source.id,
          newer === undefined ? undefined : { version: newer.pkg.manifest.version, tag: newer.tag },
        );
        if (newer === undefined) continue;
        updates += 1;
        // `extensions.autoUpdate`: only updates that ask for no new permissions.
        if (effective('extensions.autoUpdate')) {
          const preview = manager.preview(newer.pkg, {
            type: 'git',
            url: newer.url,
            tag: newer.tag,
            ...(newer.sha === undefined ? {} : { sha: newer.sha }),
          });
          if (preview.replaces?.addedPermissions.length === 0)
            await manager.install(preview.previewId);
          else manager.cancelPreview(preview.previewId);
        }
      } catch (error) {
        errors.push(`${source.id}: ${error instanceof Error ? error.message : 'the check failed'}`);
      }
    }
    return { updates, errors };
  };
  // Daily update check (spec 07); updates are shown, never installed silently.
  setTimeout(() => {
    if (!effective('extensions.checkForUpdates') || manager.gitSources().length === 0) return;
    void checkUpdates().catch(() => undefined);
  }, 20_000);
  const refreshNames = async (): Promise<void> => {
    names = new Map((await manager.snapshot()).extensions.map((e) => [e.id, e.displayName]));
  };
  await manager.load().catch(() => undefined);
  await refreshNames();
  void userThemes.reload();
  app.on('will-quit', () => {
    void manager.dispose();
    host.dispose();
  });
  const operations: ExtensionsOperations = {
    snapshot: () => manager.snapshot(),
    installFromFile: async () => {
      const options: Electron.OpenDialogOptions = {
        title: 'Install Extension from File',
        properties: ['openFile'],
        filters: [{ name: 'Raml KQL extensions', extensions: ['rkqlx', 'zip'] }],
      };
      const result =
        mainWindow === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options);
      const [file] = result.filePaths;
      if (result.canceled || file === undefined) return { type: 'cancelled' };
      const info = await stat(file);
      if (info.size > EXTENSION_LIMITS.maxTotalBytes)
        throw extensionError('The file is larger than 50 MB.');
      const pkg = readExtensionZip(new Uint8Array(await readFile(file)));
      return {
        type: 'preview',
        preview: manager.preview(pkg, { type: 'file', name: path.basename(file) }),
      };
    },
    installFromGit: async (url) => {
      const resolved = await resolveGitExtension({
        url,
        fetch: appFetch,
        tempRoot: app.getPath('temp'),
      });
      if (resolved === undefined) return { type: 'cancelled' };
      return {
        type: 'preview',
        preview: manager.preview(resolved.pkg, {
          type: 'git',
          url: resolved.url,
          tag: resolved.tag,
          ...(resolved.sha === undefined ? {} : { sha: resolved.sha }),
        }),
      };
    },
    checkUpdates: () => checkUpdates(),
    update: async (id) => {
      const source = manager.gitSources().find((s) => s.id === id);
      if (source === undefined)
        throw extensionError('Only extensions installed from git can be updated.');
      const resolved = await resolveGitExtension({
        url: source.url,
        fetch: appFetch,
        tempRoot: app.getPath('temp'),
        newerThan: source.version,
      });
      if (resolved === undefined) {
        manager.setUpdate(id, undefined);
        return { type: 'cancelled' };
      }
      return {
        type: 'preview',
        preview: manager.preview(resolved.pkg, {
          type: 'git',
          url: resolved.url,
          tag: resolved.tag,
          ...(resolved.sha === undefined ? {} : { sha: resolved.sha }),
        }),
      };
    },
    confirmInstall: async (previewId) => {
      const snapshot = await manager.install(previewId);
      await refreshNames();
      return snapshot;
    },
    cancelInstall: (previewId) => {
      manager.cancelPreview(previewId);
    },
    uninstall: (id) => manager.uninstall(id),
    setEnabled: (id, enabled) => manager.setEnabled(id, enabled),
    executeCommand: (command, args, runId, fromResults) =>
      manager.executeCommand(command, args, runId, fromResults),
    enrich: (extensionId, enricherId, runId, entities) =>
      manager.enrich(extensionId, enricherId, runId, entities),
    resultsAccess: (extensionId, runId, rows) => manager.resultsAccess(extensionId, runId, rows),
    resolveView: (viewId) => manager.resolveView(viewId),
    webviewMessage: (viewId, message) => manager.webviewMessage(viewId, message),
    respond: (requestId, value) => {
      ui.respond(requestId, value);
    },
    revoke: (id, permission) => manager.revoke(id, permission),
    readme: (id) => manager.readme(id),
  };
  return { manager, broker, ui, operations };
}

const NEW_EXTENSIONS_FILE = `{
  // Installed extensions (managed by the Extensions view). Files live in ./extensions/, which is
  // machine-local; with a shared config, the same set can be reinstalled on another machine.
  "extensions": []
}
`;

const NEW_PERMISSIONS_FILE = `{
  // "Always allow" grants for extensions. Revoke them in the Extensions view, or delete entries here.
  "grants": []
}
`;

/** Query pack sources (spec 08): load installed packs, then check for updates in the background. */
async function createPacks(myQueries: QueriesService) {
  const credentials = new CredentialStore(
    path.join(app.getPath('userData'), 'credentials.json'),
    safeStorage,
  );
  const service = new PacksService({
    sourcesDir: paths.sourcesDir,
    stateFile: paths.packSourcesStateFile,
    store: new JsoncSourcesStore(paths.sourcesFile),
    credentials,
    onChange: () => {
      emit('packs.changed', {});
    },
  });
  await service.cleanUp().catch(() => undefined);
  await service.reload().catch(() => undefined);
  const operations = createPacksOperations({
    service,
    saveQuery: (request) => myQueries.save(request),
    pick: async (kind) => {
      const options: Electron.OpenDialogOptions =
        kind === 'folder'
          ? { title: 'Import Query Pack Folder', properties: ['openDirectory'] }
          : {
              title: 'Import Query Pack or Queries',
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: 'Query packs and queries', extensions: ['rkqlpack', 'zip', 'kql'] },
              ],
            };
      const result =
        mainWindow === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options);
      return result.canceled ? undefined : result.filePaths;
    },
  });
  // Startup update check (throttled to once a day per source). Never applied silently unless
  // `sources.autoUpdate` says so.
  setTimeout(() => {
    if (!effective('sources.checkForUpdates')) return;
    void service
      .checkUpdates({ force: false })
      .then(async ({ updates }) => {
        if (updates === 0 || !effective('sources.autoUpdate')) return;
        const snapshot = await service.snapshot();
        for (const source of snapshot.sources) {
          if (source.update !== undefined) await service.applyUpdate(source.id, source.update.sha);
        }
      })
      .catch(() => undefined);
  }, 15_000);
  return { service, operations };
}

function createQueryServices(auth: AuthService, discovery: DiscoveryService) {
  const cloud = PUBLIC_CLOUD;
  const store = ResultStore.create(path.join(app.getPath('userData'), 'session-cache'), {
    memoryBudgetBytes: () => effective('results.memoryBudgetMB') * 1024 * 1024,
    maxMergedRows: () => effective('results.maxMergedRows'),
  });
  // Crypto-shred on quit: delete the spill files and zero the session key (spec 04).
  app.on('will-quit', () => {
    store.dispose();
  });
  const audit = new AuditLog({
    dir: paths.auditDir,
    appVersion: app.getVersion(),
    enabled: () => effective('audit.enabled'),
    includeQueryText: () => effective('audit.includeQueryText'),
    retentionMonths: () => effective('audit.retentionMonths'),
  });
  const history = new HistoryService({
    file: paths.historyFile,
    maxEntries: () => effective('history.maxEntries'),
    tenantOf: (resourceId) =>
      discovery.snapshot().workspaces.find((w) => w.resourceId === resourceId)?.tenantId,
    onChange: () => {
      emit('history.changed', {});
    },
  });
  // The built-in Log Analytics source (or the demo source) behind the same interface as
  // extension data sources (spec 01).
  const dataSources = new DataSourceRegistry();
  dataSources.register(
    LOG_ANALYTICS_SOURCE,
    'Log Analytics',
    mode.demo
      ? new DemoDataSource()
      : {
          execute: (request) =>
            executeLogAnalyticsQuery({
              cloud,
              fetch: azureHttp.fetch,
              token: request.token,
              customerId: request.workspace.customerId,
              query: request.query,
              timespan: request.timespan,
              timeoutSeconds: request.timeoutSeconds,
              requestId: request.requestId,
              signal: request.signal,
            }),
        },
  );
  const accountName = (accountId: string): string =>
    auth.snapshot().accounts.find((a) => a.id === accountId)?.username ?? accountId;
  const engine = new QueryEngine({
    workspace: (resourceId) =>
      discovery.snapshot().workspaces.find((w) => w.resourceId === resourceId),
    tenantName: (tenantId) => {
      const tenant = discovery.snapshot().tenants.find((t) => t.tenantId === tenantId);
      return tenant?.displayName ?? tenant?.defaultDomain ?? tenantId;
    },
    accountName,
    getToken: (request) => auth.getToken(request),
    source: dataSources.router(),
    scheduler: new Scheduler({
      perPrincipal: () => effective('query.maxConcurrentPerAccount'),
      total: () => effective('query.maxConcurrentTotal'),
      bucketCapacity: ENGINE_DEFAULTS.bucketCapacity,
      bucketWindowMs: ENGINE_DEFAULTS.bucketWindowMs,
    }),
    store,
    audit,
    settings: () => ({
      timeoutSeconds: effective('query.timeoutSeconds'),
      failFastOnSemanticError: effective('query.failFastOnSemanticError'),
      fallbackAccessPaths: effective('query.fallbackAccessPaths'),
    }),
    demo: mode.demo,
    onChange: (snapshot) => {
      history.observe(snapshot);
      emit('query.runChanged', snapshot);
    },
  });
  /** The engine as the IPC handlers see it: runs are also recorded in the history. */
  const query = {
    run: async (request: QueryRunRequest) => {
      // Pack parameters become typed `let` statements (spec 08); history keeps what ran.
      const prepared = withParameters(request);
      const snapshot = await engine.run(prepared);
      if (effective('history.maxEntries') > 0) history.started(snapshot.runId, prepared);
      history.observe(engine.get(snapshot.runId) ?? snapshot); // may have finished already
      return snapshot;
    },
    cancel: (runId: string) => engine.cancel(runId),
    rerun: (request: RerunRequest) => engine.rerun(request),
    get: (runId: string) => engine.get(runId),
    deleteRun: (runId: string) => engine.deleteRun(runId),
    deleteAll: () => engine.deleteAll(),
  };

  const views = new ResultViews(store);
  let lastExportFolder: string | undefined;
  const exports = new ExportService({
    store,
    views,
    csv: () => ({ delimiter: effective('export.csv.delimiter'), bom: effective('export.csv.bom') }),
    saveDialog: async ({ defaultPath, filters }) => {
      const options = { defaultPath, filters };
      const result =
        mainWindow === undefined
          ? await dialog.showSaveDialog(options)
          : await dialog.showSaveDialog(mainWindow, options);
      return result.canceled ? undefined : result.filePath;
    },
    writeClipboard: (text) => clipboard.writeText(text),
    lastFolder: {
      get: () => lastExportFolder,
      set: (folder) => {
        lastExportFolder = folder;
      },
    },
    defaultFolder: () => app.getPath('downloads'),
  });

  /** Audit sign-ins and sign-outs (not the accounts restored at startup). */
  const trackSignIns = (): void => {
    let known = new Set(auth.snapshot().accounts.map((a) => a.id));
    const names = new Map(auth.snapshot().accounts.map((a) => [a.id, a.username]));
    auth.onDidChange((snapshot) => {
      const current = new Set(snapshot.accounts.map((a) => a.id));
      for (const account of snapshot.accounts) {
        names.set(account.id, account.username);
        if (!known.has(account.id)) {
          void audit.append({ kind: 'auth', event: 'signIn', account: account.username });
        }
      }
      for (const id of known) {
        if (!current.has(id)) {
          void audit.append({ kind: 'auth', event: 'signOut', account: names.get(id) ?? id });
        }
      }
      known = current;
    });
  };

  return { query, store, views, exports, audit, history, trackSignIns };
}

function createAuthService(): AuthService {
  const cloud = PUBLIC_CLOUD;
  const persistence = mode.demo
    ? 'encrypted'
    : resolveTokenPersistence(
        safeStorage,
        process.platform,
        settings.current.values['auth.sessionOnly'] === true,
      );
  const msal = (kind: 'builtin' | 'custom', clientId: string): MsalAuthProvider =>
    new MsalAuthProvider({
      kind,
      clientId,
      cloud,
      openBrowser: openSignInPage,
      networkClient: azureHttp.msalNetworkModule(),
      // Kept in userData (machine-local), never in the shareable config dir.
      ...(persistence === 'encrypted'
        ? {
            cachePlugin: new EncryptedFileCachePlugin(
              path.join(app.getPath('userData'), 'auth', `msal-cache-${clientId}.bin`),
              safeStorage,
            ),
          }
        : {}),
    });

  const demo = mode.demo ? new DemoAuthProvider() : undefined;
  const providers: AuthProviders =
    demo !== undefined
      ? { demo }
      : {
          ...(BUILTIN_CLIENT_ID === undefined
            ? {}
            : { builtin: msal('builtin', BUILTIN_CLIENT_ID) }),
          azureCli: new AzureCliAuthProvider(cloud),
          custom: (clientId) => msal('custom', clientId),
        };

  return new AuthService({
    cloud,
    providers,
    persistence,
    config: mode.demo ? new MemoryAccountsConfig() : new JsoncAccountsConfig(paths.accountsFile),
    listTenants: (account, token) =>
      demo !== undefined
        ? Promise.resolve(demo.tenantsFor(account.id))
        : listTenants({
            cloud,
            token,
            homeTenantId: account.homeTenantId,
            fetch: azureHttp.fetch,
          }),
    onChange: (snapshot) => {
      emit('accounts.changed', snapshot);
    },
    onDeviceCode: (prompt) => {
      emit('accounts.deviceCode', prompt);
    },
  });
}

/** Report changes anywhere under My Queries (debounced), e.g. after a `git pull`. */
function watchQueries(dir: string, onChange: () => void): void {
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watch(dir, { recursive: true, persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 200);
    });
    watcher.on('error', () => undefined);
  } catch {
    // Not watchable: the Library still refreshes after changes made in the app.
  }
}

async function createIfMissing(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

function windowOperations(): WindowOperations {
  const win = (): BrowserWindow | undefined => mainWindow;
  return {
    setTitleBarOverlay: (colors) => {
      if (process.platform !== 'darwin') win()?.setTitleBarOverlay(colors);
    },
    setMenu: (model) => {
      if (process.platform !== 'darwin') return;
      const template = buildMacMenuTemplate(APP_NAME, model, (command) => {
        emit('menu.runCommand', { command });
      });
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    },
    runEditRole: (role) => {
      const contents = win()?.webContents;
      if (contents === undefined) return;
      const actions = {
        undo: () => {
          contents.undo();
        },
        redo: () => {
          contents.redo();
        },
        cut: () => {
          contents.cut();
        },
        copy: () => {
          contents.copy();
        },
        paste: () => {
          contents.paste();
        },
        selectAll: () => {
          contents.selectAll();
        },
      };
      actions[role]();
    },
    toggleFullScreen: () => {
      const w = win();
      w?.setFullScreen(!w.isFullScreen());
    },
    toggleDevTools: () => {
      win()?.webContents.toggleDevTools();
    },
    reload: () => {
      win()?.webContents.reload();
    },
    zoom: (action) => {
      const contents = win()?.webContents;
      if (contents === undefined) return 0;
      const step = action === 'in' ? 1 : -1;
      const next =
        action === 'reset' ? 0 : Math.max(-8, Math.min(8, contents.getZoomLevel() + step));
      contents.setZoomLevel(next);
      return next;
    },
  };
}

function showAbout(): void {
  if (process.platform === 'darwin') {
    app.showAboutPanel();
    return;
  }
  const detail = [
    `Version: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Chromium: ${process.versions.chrome}`,
    `Node.js: ${process.versions.node}`,
    `OS: ${process.platform} ${process.arch}`,
  ].join('\n');
  const options = {
    type: 'info' as const,
    title: APP_NAME,
    message: APP_NAME,
    detail,
    buttons: ['OK', 'Copy'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const shown =
    mainWindow === undefined
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(mainWindow, options);
  void shown.then(({ response }) => {
    if (response === 1) void clipboard.writeText(detail);
  });
}

function registerAppProtocol(): void {
  const rendererRoot = path.join(__dirname, '../renderer');
  const csp = buildWorkbenchCsp({ mode: 'production' });

  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppFile(request.url, rendererRoot);
    if (filePath === undefined) {
      return new Response('Not found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    // Dark Modern colours; the renderer recolours the title bar once the theme is known.
    backgroundColor: '#1f1f1f',
    ...titleBarOptions(process.platform, { color: '#181818', symbolColor: '#cccccc' }),
    webPreferences: secureWebPreferences(path.join(__dirname, '../preload/index.js')),
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('enter-full-screen', () => {
    emit('window.fullScreenChanged', { fullScreen: true });
  });
  window.on('leave-full-screen', () => {
    emit('window.fullScreenChanged', { fullScreen: false });
  });
  window.on('closed', () => {
    mainWindow = undefined;
  });

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return window;
}
