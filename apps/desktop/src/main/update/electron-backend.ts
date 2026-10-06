import type { AppUpdater } from 'electron-updater';

import type { BackendHandlers, UpdaterBackend } from './updater';

/** Wraps electron-updater's `autoUpdater` (GitHub Releases, from the build's `publish` config). */
export async function createElectronBackend(): Promise<UpdaterBackend> {
  // electron-updater is CommonJS: depending on the bundler, the named export is on `default`.
  const module = (await import('electron-updater')) as unknown as {
    autoUpdater?: AppUpdater;
    default?: { autoUpdater: AppUpdater };
  };
  const autoUpdater = module.autoUpdater ?? module.default?.autoUpdater;
  if (autoUpdater === undefined) throw new Error('electron-updater is not available');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // electron-updater logs through console by default; keep it out of the user's way.
  autoUpdater.logger = null;

  return {
    configure: ({ allowPrerelease }) => {
      autoUpdater.allowPrerelease = allowPrerelease;
    },
    checkForUpdates: async () => {
      await autoUpdater.checkForUpdates();
    },
    quitAndInstall: () => {
      autoUpdater.quitAndInstall();
    },
    subscribe: (handlers: BackendHandlers) => {
      const onAvailable = (info: { version: string }): void => {
        handlers.available(info.version);
      };
      const onNotAvailable = (): void => {
        handlers.notAvailable();
      };
      const onProgress = (info: { percent: number }): void => {
        handlers.progress(info.percent);
      };
      const onDownloaded = (info: { version: string }): void => {
        handlers.downloaded(info.version);
      };
      const onError = (error: unknown): void => {
        handlers.error(error);
      };
      autoUpdater.on('update-available', onAvailable);
      autoUpdater.on('update-not-available', onNotAvailable);
      autoUpdater.on('download-progress', onProgress);
      autoUpdater.on('update-downloaded', onDownloaded);
      autoUpdater.on('error', onError);
      return () => {
        autoUpdater.off('update-available', onAvailable);
        autoUpdater.off('update-not-available', onNotAvailable);
        autoUpdater.off('download-progress', onProgress);
        autoUpdater.off('update-downloaded', onDownloaded);
        autoUpdater.off('error', onError);
      };
    },
  };
}

/** Why this install can't update itself, or `undefined` when it can. */
export function unsupportedReason(options: {
  packaged: boolean;
  demo: boolean;
  platform: NodeJS.Platform;
  appImage: string | undefined;
}): string | undefined {
  if (options.demo) return 'Updates are disabled in demo mode.';
  if (!options.packaged) return 'Updates are only available in installed builds.';
  if (options.platform === 'linux' && (options.appImage ?? '') === '') {
    return 'This install came from a deb or rpm package: update it with your package manager, or use the AppImage for automatic updates.';
  }
  return undefined;
}
