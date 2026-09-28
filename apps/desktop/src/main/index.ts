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

import { resolveAppMode } from './app-mode';
import { JsoncAccountsConfig, MemoryAccountsConfig } from './auth/accounts-config';
import { AuthService, type AuthProviders } from './auth/auth-service';
import { AzureCliAuthProvider } from './auth/azure-cli-provider';
import { PUBLIC_CLOUD } from './auth/cloud';
import { DemoAuthProvider } from './auth/demo-provider';
import { EncryptedFileCachePlugin, resolveTokenPersistence } from './auth/encrypted-cache-plugin';
import { MsalAuthProvider } from './auth/msal-provider';
import { listTenants } from './azure/arm-tenants';
import { configPaths, ensureConfigDir, resolveConfigDir } from './config/config-dir';
import { watchDirectory } from './config/config-watcher';
import { createEventSender } from './ipc/events';
import { createIpcHandlers, type WindowOperations } from './ipc/handlers';
import { registerIpcRouter } from './ipc/router';
import { KeybindingsService, NEW_KEYBINDINGS_FILE } from './keybindings/keybindings-service';
import { APP_ENTRY_URL, APP_ORIGIN, APP_SCHEME, resolveAppFile } from './protocol/app-protocol';
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
const keybindings = new KeybindingsService(paths.keybindingsFile);
const userThemes = new UserThemesService(paths.themesDir);
const layoutStore = new LayoutStore(paths.layoutStateFile);

let mainWindow: BrowserWindow | undefined;
const emit = createEventSender(() => (mainWindow === undefined ? [] : [mainWindow.webContents]));

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
    void auth.init();

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
        : // net.fetch uses Chromium's network stack, so system proxy settings apply.
          listTenants({
            cloud,
            token,
            homeTenantId: account.homeTenantId,
            fetch: (url, init) => net.fetch(url, init),
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
