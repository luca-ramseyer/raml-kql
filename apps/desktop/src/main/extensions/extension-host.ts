import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BrowserWindow,
  MessageChannelMain,
  net,
  session,
  type MessagePortMain,
  type Session,
} from 'electron';

import { buildExtensionHostCsp } from '../../shared/security/csp';
import {
  APP_SCHEME,
  EXTHOST_ENTRY_URL,
  EXTHOST_HOST,
  resolveAppFile,
} from '../protocol/app-protocol';
import { denyAllPermissions } from '../security/permissions';
import { secureWebPreferences } from '../security/web-preferences';

/**
 * The hidden extension host window (spec 01, 07). It runs in its own in-memory session that
 * cancels every request except the host page's own files, on top of the page's CSP
 * (`connect-src 'none'`). One Web Worker per extension; each gets a MessagePort to main.
 */
export interface ExtensionHostOptions {
  preload: string;
  rendererRoot: string;
  /** `electron-vite dev`: the page comes from the Vite dev server. */
  devServerUrl?: string | undefined;
}

export class ExtensionHostWindow {
  private window: BrowserWindow | undefined;
  private loading: Promise<BrowserWindow> | undefined;

  constructor(private readonly options: ExtensionHostOptions) {}

  private configureSession(): Session {
    const ses = session.fromPartition('raml-kql-exthost');
    denyAllPermissions(ses);
    const csp = buildExtensionHostCsp({ mode: 'production' });
    if (!ses.protocol.isProtocolHandled(APP_SCHEME)) {
      ses.protocol.handle(APP_SCHEME, async (request) => {
        const file = resolveAppFile(request.url, this.options.rendererRoot, EXTHOST_HOST);
        if (file === undefined) return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(file).toString());
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', csp);
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, headers });
      });
    }
    const dev = this.options.devServerUrl;
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed =
        details.url.startsWith(`${APP_SCHEME}://${EXTHOST_HOST}/`) ||
        details.url.startsWith('blob:') ||
        details.url.startsWith('devtools:') ||
        (dev !== undefined &&
          (details.url.startsWith(dev) || details.url.startsWith(dev.replace(/^http/, 'ws'))));
      callback({ cancel: !allowed });
    });
    return ses;
  }

  private load(): Promise<BrowserWindow> {
    this.loading ??= (async () => {
      const window = new BrowserWindow({
        show: false,
        width: 400,
        height: 300,
        webPreferences: secureWebPreferences(this.options.preload, {
          session: this.configureSession(),
        }),
      });
      window.on('closed', () => {
        this.window = undefined;
        this.loading = undefined;
      });
      const dev = this.options.devServerUrl;
      await window.loadURL(
        dev === undefined
          ? EXTHOST_ENTRY_URL
          : new URL('exthost/index.html', `${dev.replace(/\/$/, '')}/`).toString(),
      );
      this.window = window;
      return window;
    })();
    return this.loading;
  }

  /** Start an extension's worker; returns main's end of its port. */
  async start(extensionId: string, code: string): Promise<MessagePortMain> {
    const window = await this.load();
    const { port1, port2 } = new MessageChannelMain();
    window.webContents.postMessage('exthost:start', { id: extensionId, code }, [port2]);
    return port1;
  }

  stop(extensionId: string): void {
    this.window?.webContents.send('exthost:stop', { id: extensionId });
  }

  dispose(): void {
    this.window?.destroy();
    this.window = undefined;
    this.loading = undefined;
  }
}

export function extensionHostPreload(mainDir: string): string {
  return path.join(mainDir, '../preload/exthost.js');
}
