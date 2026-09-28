import type { AppInfo } from '../../shared/ipc/contracts';
import { registerAccountCommands } from '../features/accounts/account-commands';
import {
  accountName,
  applyAccountsSnapshot,
  loadAccounts,
  setNameFormatters,
  showDeviceCode,
} from '../features/accounts/accounts-store';
import { preloadQueryEditorWhenIdle } from '../features/editor/editor-preload';
import { currentNamer, startPrivacy } from '../features/privacy/privacy';
import { registerQueryCommands } from '../features/query/query-commands';
import { applyRunSnapshot, useRuns } from '../features/query/run-store';
import { registerResultCommands } from '../features/results/result-commands';
import {
  selectedWorkspaces,
  syncTargetsWithInventory,
  useTargets,
} from '../features/targets/targets-store';
import {
  applyGroups,
  applyInventory,
  loadInventory,
  notifyNewWorkspaces,
  useInventory,
} from '../features/workspaces/inventory-store';
import { registerWorkspaceCommands } from '../features/workspaces/workspace-commands';
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
    // Subscribe fresh closures, never shared functions: zustand keeps listeners in a Set, so
    // two workbench starts (React StrictMode in dev) would share one entry, and the first
    // start's teardown would unsubscribe the second.
    useSettings.subscribe(() => {
      refreshTheme();
    }),
    bridge.events.on('accounts.changed', applyAccountsSnapshot),
    bridge.events.on('accounts.deviceCode', showDeviceCode),
    bridge.events.on('inventory.changed', applyInventory),
    bridge.events.on('inventory.newWorkspaces', ({ count }) => {
      notifyNewWorkspaces(count);
    }),
    bridge.events.on('groups.changed', applyGroups),
    bridge.events.on('query.runChanged', applyRunSnapshot),
    useInventory.subscribe(() => {
      syncTargetsWithInventory();
    }),
    registerBuiltinCommands(),
    registerAccountCommands(),
    registerWorkspaceCommands(),
    registerQueryCommands(),
    registerResultCommands(),
    registerQuickAccess(),
    startPrivacy(),
  );
  setNameFormatters({
    tenant: (tenant) => currentNamer().tenant(tenant.tenantId, tenant),
    account: (account) => currentNamer().account(account.id, accountName(account)),
  });
  // Inventory first, so tenant aliases exist before account notifications are worded.
  await loadInventory();
  await loadAccounts();
  syncTargetsWithInventory();

  // Status bar: "$(server) 12 workspaces · 5 tenants" for the current selection (spec 03).
  const targetsItem = registerStatusBarItem({
    id: 'status.targets',
    alignment: 'left',
    priority: 1000,
    text: '',
    tooltip: 'Selected targets. Click to show Targets.',
    command: 'workbench.view.targets',
  });
  const updateTargetsItem = (): void => {
    const selected = selectedWorkspaces();
    const tenants = new Set(selected.map((w) => w.tenantId)).size;
    targetsItem.update({
      text:
        useInventory.getState().inventory.workspaces.length === 0
          ? ''
          : `$(server) ${String(selected.length)} workspace${selected.length === 1 ? '' : 's'} · ${String(tenants)} tenant${tenants === 1 ? '' : 's'}`,
    });
  };
  updateTargetsItem();
  disposers.push(
    useTargets.subscribe(updateTargetsItem),
    useInventory.subscribe(updateTargetsItem),
    () => {
      targetsItem.dispose();
    },
  );

  // Context keys mirrored from state.
  const syncContext = (): void => {
    const { sidebar, panel } = useLayout.getState();
    setContextKey('sideBarVisible', sidebar.visible);
    setContextKey('activeViewlet', sidebar.visible ? sidebar.activeView : undefined);
    setContextKey('panelVisible', panel.visible);
    setContextKey('panelMaximized', panel.visible && panel.maximized);
    const { editors, activeId } = useEditors.getState();
    setContextKey('activeEditor', activeId);
    setContextKey(
      'queryRunning',
      activeId !== undefined && useRuns.getState().byTab[activeId]?.state === 'running',
    );
    // Like VS Code's `editorLangId`: set while a query tab is active.
    setContextKey(
      'editorLangId',
      editors.find((e) => e.id === activeId)?.kind === 'query' ? 'kusto' : undefined,
    );
    setContextKey('notificationToastsVisible', useNotifications.getState().toasts.length > 0);
    setContextKey('notificationCenterVisible', useNotifications.getState().centerVisible);
  };
  syncContext();
  disposers.push(
    useLayout.subscribe(syncContext),
    useEditors.subscribe(syncContext),
    useRuns.subscribe(syncContext),
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

  // Load the query editor while idle so the first query tab opens instantly. Unit tests
  // (jsdom) can't run Monaco.
  if (import.meta.env.MODE !== 'test') disposers.push(preloadQueryEditorWhenIdle());

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
