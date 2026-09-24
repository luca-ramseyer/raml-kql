import type {
  KeybindingsSnapshot,
  SettingsSnapshot,
  UserThemesSnapshot,
} from '../../shared/config/config-snapshots';
import { AppError } from '../../shared/errors';
import type { AppInfo, IpcHandlers, SettingsUpdateRequest } from '../../shared/ipc/contracts';
import type { LayoutState } from '../../shared/layout/layout-state';
import type { MenuBarModel, MenuRole } from '../../shared/menus/menu-model';
import { isAllowedExternalUrl } from '../security/navigation';

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
  settings: {
    current: SettingsSnapshot;
    update(request: SettingsUpdateRequest): Promise<SettingsSnapshot>;
  };
  keybindings: { current: KeybindingsSnapshot };
  userThemes: () => UserThemesSnapshot;
  layout: { read(): Promise<LayoutState>; write(state: LayoutState): Promise<void> };
  window: WindowOperations;
  shell: {
    openConfigFile(file: 'settings' | 'keybindings'): Promise<void>;
    openConfigFolder(): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
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
