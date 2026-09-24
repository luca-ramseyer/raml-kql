import {
  commandLabel,
  executeCommand,
  isCommandEnabled,
  recordRecentCommand,
  registerCommand,
  useCommands,
} from '../platform/commands';
import { closeActiveEditor, openEditor, useEditors } from '../platform/editors';
import { keybindingLabel } from '../platform/keybindings/keybinding-service';
import { showView, toggleMaximizedPanel, togglePanel, toggleSidebar } from '../platform/layout';
import {
  clearAllNotifications,
  hideAllToasts,
  notify,
  toggleNotificationCenter,
} from '../platform/notifications';
import {
  filterQuickPickItems,
  hideQuickInput,
  openQuickAccess,
  quickAccessProviders,
  registerQuickAccessProvider,
  setQuickInputActiveIndex,
  showQuickPick,
  type QuickPickItem,
} from '../platform/quickinput/quick-input';
import { getSetting, updateSetting } from '../platform/settings';
import {
  allThemes,
  configuredThemeLabel,
  previewTheme,
  useTheme,
} from '../platform/theme/theme-service';
import { getBridge, unwrap } from '../services/ipc';

import { VIEWS } from './views';

const DOCS_URL = 'https://github.com/luca-ramseyer/raml-kql#readme';
const ISSUES_URL = 'https://github.com/luca-ramseyer/raml-kql/issues/new';

/** Register every built-in command. Returns a function that unregisters them. */
export function registerBuiltinCommands(): () => void {
  const disposers = [
    // --- Quick input -------------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.showCommands',
      title: 'Show All Commands',
      run: () => {
        openQuickAccess('>');
      },
    }),
    registerCommand({
      id: 'workbench.action.quickOpen',
      title: 'Go to Query...',
      run: () => {
        openQuickAccess('');
      },
    }),
    registerCommand({
      id: 'workbench.action.closeQuickOpen',
      title: 'Close Quick Open',
      hideFromPalette: true,
      when: 'inQuickOpen',
      run: () => {
        hideQuickInput();
      },
    }),

    // --- Layout ------------------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.toggleSidebarVisibility',
      title: 'Toggle Primary Side Bar Visibility',
      category: 'View',
      run: () => {
        toggleSidebar();
      },
    }),
    registerCommand({
      id: 'workbench.action.togglePanel',
      title: 'Toggle Panel Visibility',
      category: 'View',
      run: () => {
        togglePanel();
      },
    }),
    registerCommand({
      id: 'workbench.action.toggleMaximizedPanel',
      title: 'Toggle Maximized Panel',
      category: 'View',
      run: () => {
        toggleMaximizedPanel();
      },
    }),
    registerCommand({
      id: 'workbench.action.toggleStatusbarVisibility',
      title: 'Toggle Status Bar Visibility',
      category: 'View',
      run: () =>
        updateSetting('workbench.statusBar.visible', !getSetting('workbench.statusBar.visible')),
    }),
    registerCommand({
      id: 'workbench.action.toggleFullScreen',
      title: 'Toggle Full Screen',
      category: 'View',
      run: () => getBridge().window.toggleFullScreen(),
    }),
    ...VIEWS.map((view) =>
      registerCommand({
        id: view.id,
        title: `Show ${view.title}`,
        category: 'View',
        run: () => {
          showView(view.id);
        },
      }),
    ),

    // --- Editors -----------------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.closeActiveEditor',
      title: 'Close Editor',
      category: 'View',
      when: 'activeEditor',
      run: () => {
        closeActiveEditor();
      },
    }),
    registerCommand({
      id: 'workbench.action.showWelcomePage',
      title: 'Welcome',
      category: 'Help',
      run: () => {
        openEditor('welcome');
      },
    }),

    // --- Preferences -------------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.openSettings',
      title: 'Open Settings (UI)',
      category: 'Preferences',
      run: () => {
        openEditor('settings');
      },
    }),
    registerCommand({
      id: 'workbench.action.openSettingsJson',
      title: 'Open User Settings (JSON)',
      category: 'Preferences',
      run: () => getBridge().shell.openConfigFile({ file: 'settings' }),
    }),
    registerCommand({
      id: 'workbench.action.openGlobalKeybindingsFile',
      title: 'Open Keyboard Shortcuts (JSON)',
      category: 'Preferences',
      run: () => getBridge().shell.openConfigFile({ file: 'keybindings' }),
    }),
    registerCommand({
      id: 'workbench.action.openConfigFolder',
      title: 'Open Config Folder',
      category: 'Preferences',
      run: () => getBridge().shell.openConfigFolder(),
    }),
    registerCommand({
      id: 'workbench.action.selectTheme',
      title: 'Color Theme',
      category: 'Preferences',
      run: () => {
        showThemePicker();
      },
    }),

    // --- Window ------------------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.zoomIn',
      title: 'Zoom In',
      category: 'View',
      run: () => getBridge().window.zoom({ action: 'in' }),
    }),
    registerCommand({
      id: 'workbench.action.zoomOut',
      title: 'Zoom Out',
      category: 'View',
      run: () => getBridge().window.zoom({ action: 'out' }),
    }),
    registerCommand({
      id: 'workbench.action.zoomReset',
      title: 'Reset Zoom',
      category: 'View',
      run: () => getBridge().window.zoom({ action: 'reset' }),
    }),
    registerCommand({
      id: 'workbench.action.quit',
      title: 'Quit',
      category: 'File',
      hideFromPalette: true,
      run: () => {
        window.close();
      },
    }),

    // --- Notifications -----------------------------------------------------------------------
    registerCommand({
      id: 'notifications.toggleList',
      title: 'Toggle Notifications',
      category: 'Notifications',
      run: () => {
        toggleNotificationCenter();
      },
    }),
    registerCommand({
      id: 'notifications.clearAll',
      title: 'Clear All Notifications',
      category: 'Notifications',
      run: () => {
        clearAllNotifications();
      },
    }),
    registerCommand({
      id: 'notifications.hideToasts',
      title: 'Hide Notification Toasts',
      category: 'Notifications',
      hideFromPalette: true,
      when: 'notificationToastsVisible',
      run: () => {
        hideAllToasts();
      },
    }),

    // --- Help and developer ------------------------------------------------------------------
    registerCommand({
      id: 'workbench.action.openDocumentation',
      title: 'Documentation',
      category: 'Help',
      run: () => unwrap(getBridge().shell.openExternal({ url: DOCS_URL })),
    }),
    registerCommand({
      id: 'workbench.action.openIssueReporter',
      title: 'Report Issue',
      category: 'Help',
      run: () => unwrap(getBridge().shell.openExternal({ url: ISSUES_URL })),
    }),
    registerCommand({
      id: 'workbench.action.showAboutDialog',
      title: 'About',
      category: 'Help',
      run: () => getBridge().app.showAbout(),
    }),
    registerCommand({
      id: 'workbench.action.toggleDevTools',
      title: 'Toggle Developer Tools',
      category: 'Developer',
      run: () => getBridge().window.toggleDevTools(),
    }),
    registerCommand({
      id: 'workbench.action.reloadWindow',
      title: 'Reload Window',
      category: 'Developer',
      run: () => getBridge().window.reload(),
    }),
    registerCommand({
      id: 'workbench.action.restartInDemoMode',
      title: 'Restart in Demo Mode',
      category: 'Developer',
      when: '!demoMode',
      run: () => getBridge().app.relaunch({ demo: true }),
    }),
    registerCommand({
      id: 'workbench.action.restartInLiveMode',
      title: 'Exit Demo Mode (Restart)',
      category: 'Developer',
      when: 'demoMode',
      run: () => getBridge().app.relaunch({ demo: false }),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** `>`: the command palette, with "recently used" first like VS Code. */
function commandItems(filter: string): QuickPickItem[] {
  const { commands, recent } = useCommands.getState();
  const visible = [...commands.values()].filter(
    (command) => command.hideFromPalette !== true && isCommandEnabled(command),
  );
  const toItem = (id: string, group: string | undefined): QuickPickItem | undefined => {
    const command = commands.get(id);
    if (command === undefined || !visible.includes(command)) return undefined;
    return { id, label: commandLabel(command), keybinding: keybindingLabel(id), group };
  };
  const recentItems = recent
    .map((id) => toItem(id, 'recently used'))
    .filter((item): item is QuickPickItem => item !== undefined);
  const recentIds = new Set(recentItems.map((item) => item.id));
  const others = visible
    .filter((command) => !recentIds.has(command.id))
    .map((command) => toItem(command.id, recentItems.length > 0 ? 'other commands' : undefined))
    .filter((item): item is QuickPickItem => item !== undefined)
    .sort((a, b) => a.label.localeCompare(b.label));
  // While filtering, best matches first (like VS Code); otherwise recently used, then A–Z.
  return filterQuickPickItems([...recentItems, ...others], filter, { sort: filter.trim() !== '' });
}

export function registerQuickAccess(): () => void {
  const disposers = [
    registerQuickAccessProvider({
      prefix: '>',
      helpText: 'Show and Run Commands',
      placeholder: 'Type the name of a command to run.',
      noResultsText: 'No matching commands',
      getItems: commandItems,
      onAccept: (item) => {
        if (item === undefined) return;
        recordRecentCommand(item.id, getSetting('workbench.commandPalette.history'));
        void executeCommand(item.id);
      },
    }),
    registerQuickAccessProvider({
      prefix: '?',
      helpText: 'Help',
      placeholder: 'Type a prefix to see what you can do.',
      getItems: (filter) =>
        filterQuickPickItems(
          quickAccessProviders()
            .filter((p) => p.prefix !== '?')
            .map((p) => ({
              id: `help:${p.prefix}`,
              label: p.prefix === '' ? '…' : p.prefix,
              description: p.helpText,
            })),
          filter,
          { matchDescription: true },
        ),
      onAccept: (item) => {
        if (item !== undefined) {
          openQuickAccess(item.id.slice('help:'.length));
        }
      },
    }),
    registerQuickAccessProvider({
      prefix: '',
      helpText: 'Go to Query (open editors; saved queries and history arrive later)',
      placeholder: 'Search open editors (append > to run commands, ? for help)',
      noResultsText: 'No matching editors. Type > to search commands.',
      getItems: (filter) =>
        filterQuickPickItems(
          useEditors.getState().editors.map((editor) => ({
            id: `editor:${editor.id}`,
            label: editor.title,
            icon: editor.icon,
            description: 'open editor',
          })),
          filter,
          { sort: true },
        ),
      onAccept: (item) => {
        const editor = useEditors.getState().editors.find((e) => `editor:${e.id}` === item?.id);
        if (editor !== undefined) openEditor(editor.kind);
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** VS Code's colour theme picker: grouped by light/dark/high contrast, with live preview. */
export function showThemePicker(): void {
  const current = configuredThemeLabel();
  const groups = [
    { label: 'light themes', match: 'vs' },
    { label: 'dark themes', match: 'vs-dark' },
    { label: 'high contrast themes', match: 'hc' },
  ];
  const items: QuickPickItem[] = groups.flatMap((group) =>
    allThemes()
      .filter((theme) =>
        group.match === 'hc' ? theme.uiTheme.startsWith('hc') : theme.uiTheme === group.match,
      )
      .map((theme) => ({
        id: theme.id,
        label: theme.label,
        description: theme.id.startsWith('user:') ? 'user theme' : undefined,
        group: group.label,
      })),
  );
  const autoDetect = getSetting('window.autoDetectColorScheme');
  const labelOf = (id: string | undefined): string | undefined =>
    allThemes().find((theme) => theme.id === id)?.label;

  showQuickPick({
    placeholder: 'Select Color Theme (Up/Down Keys to Preview)',
    getItems: (filter) => filterQuickPickItems(items, filter),
    onActive: (item) => {
      previewTheme(labelOf(item?.id));
    },
    onAccept: (item) => {
      previewTheme(undefined);
      const label = labelOf(item?.id);
      if (label === undefined) return;
      if (autoDetect) {
        // Like VS Code: picking a theme while following the OS updates the preferred theme
        // for the current OS appearance.
        const dark = useTheme.getState().os.dark;
        const key = dark
          ? 'workbench.preferredDarkColorTheme'
          : 'workbench.preferredLightColorTheme';
        void updateSetting(key, label);
        notify({
          message: `"${label}" is now your preferred ${dark ? 'dark' : 'light'} theme, used while the OS is in ${dark ? 'dark' : 'light'} mode (window.autoDetectColorScheme is on).`,
        });
      } else {
        void updateSetting('workbench.colorTheme', label);
      }
    },
    onCancel: () => {
      previewTheme(undefined);
    },
  });
  // Start with the current theme highlighted.
  const index = items.findIndex((item) => labelOf(item.id) === current);
  if (index >= 0) setQuickInputActiveIndex(index);
}
