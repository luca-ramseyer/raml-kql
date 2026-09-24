import type { AppInfo } from '../../shared/ipc/contracts';
import { executeCommand, useCommands } from '../platform/commands';
import { setContextKey, useContextKeys } from '../platform/context-keys';
import { openEditor, useEditors } from '../platform/editors';
import {
  applyKeybindingsSnapshot,
  useKeybindings,
} from '../platform/keybindings/keybinding-service';
import { initLayout, useLayout } from '../platform/layout';
import { useNotifications } from '../platform/notifications';
import { applySettingsSnapshot, getSetting, useSettings } from '../platform/settings';
import { registerStatusBarItem } from '../platform/statusbar';
import { refreshTheme, setUserThemes, watchOsAppearance } from '../platform/theme/theme-service';
import { getBridge, unwrap } from '../services/ipc';

import { registerBuiltinCommands, registerQuickAccess } from './contributions';
import { buildMenuBarModel } from './menus';

export interface WorkbenchStartup {
  info: AppInfo;
  /** Called when the window enters or leaves full screen. */
  onFullScreenChange: (fullScreen: boolean) => void;
}

/**
 * Start the workbench services. Loads settings, keybindings, themes and layout from the main
 * process, subscribes to their live changes, registers commands, and keeps context keys in
 * sync. Returns a function that tears everything down (used by tests).
 */
export async function startWorkbench({
  info,
  onFullScreenChange,
}: WorkbenchStartup): Promise<() => void> {
  const bridge = getBridge();
  const platform = info.platform;
  const disposers: (() => void)[] = [];

  setContextKey('isMac', platform === 'darwin');
  setContextKey('isWindows', platform === 'win32');
  setContextKey('isLinux', platform === 'linux');
  setContextKey('demoMode', info.demoMode);
  setContextKey('isDevelopment', info.isDevelopment);

  const [settings, keybindings, themes, layout] = await Promise.all([
    unwrap(bridge.settings.get()),
    unwrap(bridge.keybindings.get()),
    unwrap(bridge.themes.listUser()),
    unwrap(bridge.layout.get()),
  ]);
  applySettingsSnapshot(settings);
  applyKeybindingsSnapshot(platform, keybindings);
  initLayout(layout, (state) => void bridge.layout.set(state));
  setUserThemes(themes);

  disposers.push(
    bridge.events.on('settings.changed', applySettingsSnapshot),
    bridge.events.on('keybindings.changed', (snapshot) => {
      applyKeybindingsSnapshot(platform, snapshot);
    }),
    bridge.events.on('themes.changed', setUserThemes),
    bridge.events.on('menu.runCommand', ({ command }) => void executeCommand(command)),
    bridge.events.on('window.fullScreenChanged', ({ fullScreen }) => {
      onFullScreenChange(fullScreen);
    }),
    watchOsAppearance(),
    useSettings.subscribe(refreshTheme),
    registerBuiltinCommands(),
    registerQuickAccess(),
  );

  // Context keys mirrored from state.
  const syncContext = (): void => {
    const { sidebar, panel } = useLayout.getState();
    setContextKey('sideBarVisible', sidebar.visible);
    setContextKey('activeViewlet', sidebar.visible ? sidebar.activeView : undefined);
    setContextKey('panelVisible', panel.visible);
    setContextKey('panelMaximized', panel.visible && panel.maximized);
    setContextKey('activeEditor', useEditors.getState().activeId);
    setContextKey('notificationToastsVisible', useNotifications.getState().toasts.length > 0);
    setContextKey('notificationCenterVisible', useNotifications.getState().centerVisible);
  };
  syncContext();
  disposers.push(
    useLayout.subscribe(syncContext),
    useEditors.subscribe(syncContext),
    useNotifications.subscribe(syncContext),
  );

  const onFocusChange = (): void => {
    const active = document.activeElement;
    setContextKey(
      'inputFocus',
      active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable),
    );
  };
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);
  disposers.push(() => {
    document.removeEventListener('focusin', onFocusChange);
    document.removeEventListener('focusout', onFocusChange);
  });

  // Status bar: demo mode indicator (far left, like VS Code's remote indicator) and the bell.
  if (info.demoMode) {
    const demo = registerStatusBarItem({
      id: 'status.demoMode',
      alignment: 'left',
      priority: 10_000,
      text: '$(beaker) Demo Mode',
      tooltip:
        'Demo mode: fake accounts, workspaces and results. No network access. Click to exit.',
      command: 'workbench.action.restartInLiveMode',
      kind: 'remote',
    });
    disposers.push(() => {
      demo.dispose();
    });
  }
  const bell = registerStatusBarItem({
    id: 'status.notifications',
    alignment: 'right',
    priority: -10_000,
    text: '$(bell)',
    tooltip: 'No Notifications',
    command: 'notifications.toggleList',
  });
  disposers.push(
    () => {
      bell.dispose();
    },
    useNotifications.subscribe((state) => {
      const count = state.notifications.length;
      bell.update({
        text: count > 0 ? '$(bell-dot)' : '$(bell)',
        tooltip:
          count > 0
            ? `${String(count)} New Notification${count === 1 ? '' : 's'}`
            : 'No Notifications',
      });
    }),
  );

  // macOS: keep the native menu in sync with commands, keybindings and context.
  if (platform === 'darwin') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pushMenu = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void bridge.window.setMenu(buildMenuBarModel(platform));
      }, 50);
    };
    pushMenu();
    disposers.push(
      useCommands.subscribe(pushMenu),
      useKeybindings.subscribe(pushMenu),
      useContextKeys.subscribe(pushMenu),
      () => {
        clearTimeout(timer);
      },
    );
  }

  if (getSetting('workbench.startupEditor') === 'welcomePage') openEditor('welcome');

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
