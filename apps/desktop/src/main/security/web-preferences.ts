import type { Session, WebPreferences } from 'electron';

/**
 * The only way windows get their `webPreferences`. Every value here is required by
 * spec 01 ("Electron hardening"); `test/security/web-preferences.test.ts` asserts them.
 */
export function secureWebPreferences(
  preloadPath: string,
  options: { session?: Session } = {},
): WebPreferences {
  return {
    ...(options.session === undefined ? {} : { session: options.session }),
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
  };
}
