/**
 * Main-process entry point. Keep this file thin: it only wires Electron to the testable
 * modules next to it. Anything with logic belongs in its own module with a unit test.
 */
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';

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
import { JsoncWorkspacesConfig, MemoryWorkspacesConfig } from './config/workspaces-config';
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
import { createEventSender } from './ipc/events';
import { createIpcHandlers, type WindowOperations } from './ipc/handlers';
import { registerIpcRouter } from './ipc/router';
import { KeybindingsService, NEW_KEYBINDINGS_FILE } from './keybindings/keybindings-service';
import { portalQueryUrl } from './links/portal';
import { APP_ENTRY_URL, APP_ORIGIN, APP_SCHEME, resolveAppFile } from './protocol/app-protocol';
import { ENGINE_DEFAULTS } from './query/limits';
import { QueryEngine } from './query/query-engine';
import { Scheduler } from './query/scheduler';
import { ResultStore } from './results/result-store';
import { ResultViews } from './results/result-views';
import { FileSchemaCache, MemorySchemaCache } from './schema/schema-cache';
import { SchemaService } from './schema/schema-service';
import { installNavigationGuards, isTrustedOrigin, originKey } from './security/navigation';
import { denyAllPermissions } from './security/permissions';
import { secureWebPreferences } from './security/web-preferences';
import { NEW_SETTINGS_FILE, SettingsService } from './settings/settings-service';
import { LayoutStore } from './state/layout-store';
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

// Must run before `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
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

    await ensureConfigDir(paths);
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
    const groups = new GroupsService(
      mode.demo ? new MemoryGroupsStore(DEMO_GROUPS) : new JsoncGroupsStore(paths.groupsFile),
      (snapshot) => {
        emit('groups.changed', snapshot);
      },
    );
    const schema = createSchemaService(auth, discovery);
    const queries = createQueryServices(auth, discovery);
    await Promise.all([discovery.init(), groups.reload()]);
    void auth.init().then(() => {
      queries.trackSignIns();
    });
    void queries.audit.prune().catch(() => undefined);
    watchDirectory(paths.root, (file) => {
      if (file === undefined || file === 'workspaces.jsonc') void discovery.reloadConfig();
      if (file === undefined || file === 'groups.jsonc') void groups.reload();
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
        accounts: auth,
        inventory: discovery,
        schema,
        query: queries.engine,
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
    source: mode.demo
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
      emit('query.runChanged', snapshot);
    },
  });

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

  return { engine, store, views, exports, audit, trackSignIns };
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
