/**
 * Main-process entry point. Keep this file thin: it only wires Electron to the testable
 * modules next to it. Anything with logic belongs in its own module with a unit test.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';

import { buildWorkbenchCsp } from '../shared/security/csp';

import { resolveAppMode } from './app-mode';
import { createIpcHandlers } from './ipc/handlers';
import { registerIpcRouter } from './ipc/router';
import { APP_ENTRY_URL, APP_ORIGIN, APP_SCHEME, resolveAppFile } from './protocol/app-protocol';
import { installNavigationGuards, isTrustedOrigin, originKey } from './security/navigation';
import { denyAllPermissions } from './security/permissions';
import { secureWebPreferences } from './security/web-preferences';

const APP_NAME = 'Raml KQL';

// electron-vite sets this only for `electron-vite dev`. Never honour it in packaged builds.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const devServerOrigin = devServerUrl === undefined ? undefined : originKey(devServerUrl);
const trustedOrigins = [APP_ORIGIN, ...(devServerOrigin === undefined ? [] : [devServerOrigin])];

const mode = resolveAppMode(process.argv, process.env);

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
    const [window] = BrowserWindow.getAllWindows();
    if (window !== undefined) {
      if (window.isMinimized()) window.restore();
      window.focus();
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

  void app.whenReady().then(() => {
    denyAllPermissions(session.defaultSession);
    registerAppProtocol();

    registerIpcRouter({
      ipcMain,
      handlers: createIpcHandlers({
        appInfo: {
          name: APP_NAME,
          version: app.getVersion(),
          platform: process.platform as 'darwin' | 'win32' | 'linux',
          electronVersion: process.versions.electron,
          demoMode: mode.demo,
        },
        now: () => new Date(),
      }),
      isTrustedSender: (url) => isTrustedOrigin(url, trustedOrigins),
      onInternalError: (channel) => {
        // Never log payloads here; they may contain query text or result data.
        console.error(`[ipc] internal error on ${channel}`);
      },
    });

    createMainWindow();
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
    // Dark Modern editor background; avoids a white flash before the renderer paints.
    backgroundColor: '#1f1f1f',
    webPreferences: secureWebPreferences(path.join(__dirname, '../preload/index.js')),
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return window;
}
