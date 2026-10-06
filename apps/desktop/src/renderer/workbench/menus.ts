import { toElectronAccelerator, type Platform } from '../../shared/keybindings/keys';
import type { MenuBarModel, MenuItemModel, MenuRole } from '../../shared/menus/menu-model';
import { executeCommand, getCommand, isCommandEnabled } from '../platform/commands';
import { primaryKeybinding } from '../platform/keybindings/keybinding-resolver';
import { keybindingLabel, useKeybindings } from '../platform/keybindings/keybinding-service';
import { getBridge } from '../services/ipc';

import type { MenuEntry } from './common/ContextMenu';

/**
 * The application menu (spec 05: File, Edit, Selection, View, Query, Help), defined once.
 * macOS renders it natively (see main/window/menu.ts); Windows and Linux draw it in the
 * custom title bar. Items whose command isn't registered yet are hidden, and empty menus
 * disappear, so menus fill up as later phases add commands.
 */
type MenuDefItem =
  | { command: string; label?: string }
  | { role: MenuRole; label: string }
  | { submenu: string; items: MenuDefItem[] }
  | 'separator';

interface MenuDef {
  label: string;
  items: MenuDefItem[];
}

function menuDefinitions(platform: Platform): MenuDef[] {
  const mac = platform === 'darwin';
  return [
    {
      label: 'File',
      items: [
        ...(mac
          ? []
          : [
              {
                submenu: 'Preferences',
                items: [
                  { command: 'workbench.action.openSettings', label: 'Settings' },
                  {
                    command: 'workbench.action.openGlobalKeybindingsFile',
                    label: 'Keyboard Shortcuts',
                  },
                  'separator',
                  { command: 'workbench.action.selectTheme', label: 'Color Theme' },
                ] satisfies MenuDefItem[],
              },
            ]),
        { command: 'workbench.action.openConfigFolder', label: 'Open Config Folder' },
        'separator',
        { command: 'workbench.action.closeActiveEditor', label: 'Close Editor' },
        ...(mac ? [] : ['separator' as const, { command: 'workbench.action.quit', label: 'Exit' }]),
      ],
    },
    {
      label: 'Edit',
      items: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        'separator',
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
      ],
    },
    { label: 'Selection', items: [{ role: 'selectAll', label: 'Select All' }] },
    {
      label: 'View',
      items: [
        { command: 'workbench.action.showCommands', label: 'Command Palette...' },
        { command: 'workbench.action.quickOpen', label: 'Quick Open...' },
        'separator',
        { command: 'workbench.view.targets', label: 'Targets' },
        { command: 'workbench.view.library', label: 'Library' },
        { command: 'workbench.view.history', label: 'History' },
        { command: 'workbench.view.extensions', label: 'Extensions' },
        'separator',
        {
          submenu: 'Appearance',
          items: [
            { command: 'workbench.action.toggleFullScreen', label: 'Full Screen' },
            'separator',
            { command: 'workbench.action.toggleSidebarVisibility', label: 'Primary Side Bar' },
            { command: 'workbench.action.toggleStatusbarVisibility', label: 'Status Bar' },
            { command: 'workbench.action.togglePanel', label: 'Panel' },
            'separator',
            { command: 'workbench.action.zoomIn', label: 'Zoom In' },
            { command: 'workbench.action.zoomOut', label: 'Zoom Out' },
            { command: 'workbench.action.zoomReset', label: 'Reset Zoom' },
          ],
        },
      ],
    },
    { label: 'Query', items: [] },
    {
      label: 'Help',
      items: [
        { command: 'workbench.action.showWelcomePage', label: 'Welcome' },
        { command: 'workbench.action.showCommands', label: 'Show All Commands' },
        { command: 'workbench.action.openDocumentation', label: 'Documentation' },
        'separator',
        { command: 'workbench.action.openIssueReporter', label: 'Report Issue' },
        'separator',
        { command: 'update.checkForUpdates', label: 'Check for Updates…' },
        'separator',
        { command: 'workbench.action.toggleDevTools', label: 'Toggle Developer Tools' },
        ...(mac
          ? []
          : [
              'separator' as const,
              { command: 'workbench.action.showAboutDialog', label: 'About' },
            ]),
      ],
    },
  ];
}

/** Drop leading, trailing and doubled separators. */
function tidy<T>(items: T[], isSeparator: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (isSeparator(item) && (result.length === 0 || isSeparator(result[result.length - 1] as T)))
      continue;
    result.push(item);
  }
  while (result.length > 0 && isSeparator(result[result.length - 1] as T)) result.pop();
  return result;
}

function toModelItems(items: MenuDefItem[], platform: Platform): MenuItemModel[] {
  const { bindings } = useKeybindings.getState();
  const mapped = items.flatMap((item): MenuItemModel[] => {
    if (item === 'separator') return [{ kind: 'separator' }];
    if ('role' in item) return [{ kind: 'role', role: item.role, label: item.label }];
    if ('submenu' in item) {
      const children = toModelItems(item.items, platform);
      return children.length === 0
        ? []
        : [{ kind: 'submenu', label: item.submenu, items: children }];
    }
    const command = getCommand(item.command);
    if (command === undefined) return [];
    const sequence = primaryKeybinding(bindings, item.command);
    return [
      {
        kind: 'command',
        command: item.command,
        label: item.label ?? command.title,
        accelerator: sequence === undefined ? undefined : toElectronAccelerator(sequence),
        enabled: isCommandEnabled(command),
      },
    ];
  });
  return tidy(mapped, (item) => item.kind === 'separator');
}

/** The menu model for the native macOS menu. */
export function buildMenuBarModel(platform: Platform): MenuBarModel {
  return menuDefinitions(platform)
    .map((menu) => ({ label: menu.label, items: toModelItems(menu.items, platform) }))
    .filter((menu) => menu.items.length > 0);
}

/** The same menus as entries for the custom (Windows/Linux) menu bar. */
export function buildMenuBarEntries(platform: Platform): { label: string; entries: MenuEntry[] }[] {
  const toEntries = (items: MenuItemModel[]): MenuEntry[] =>
    items.map((item): MenuEntry => {
      switch (item.kind) {
        case 'separator':
          return { kind: 'separator' };
        case 'submenu':
          return { kind: 'submenu', label: item.label, entries: toEntries(item.items) };
        case 'role':
          return {
            kind: 'item',
            label: item.label,
            keybinding: ROLE_LABELS[item.role],
            run: () => void getBridge().window.runEditRole({ role: item.role }),
          };
        case 'command':
          return {
            kind: 'item',
            label: item.label,
            keybinding: keybindingLabel(item.command),
            enabled: item.enabled,
            run: () => void executeCommand(item.command),
          };
      }
    });
  return buildMenuBarModel(platform).map((menu) => ({
    label: menu.label,
    entries: toEntries(menu.items),
  }));
}

/** Keybinding labels for edit roles in the custom menu bar (Windows and Linux only). */
const ROLE_LABELS: Record<MenuRole, string> = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  selectAll: 'Ctrl+A',
};
