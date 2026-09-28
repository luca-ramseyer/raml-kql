import type { MenuItemConstructorOptions } from 'electron';

import type { MenuBarModel, MenuItemModel } from '../../shared/menus/menu-model';

function toElectronItem(
  item: MenuItemModel,
  runCommand: (command: string) => void,
): MenuItemConstructorOptions {
  switch (item.kind) {
    case 'separator':
      return { type: 'separator' };
    case 'role':
      // Roles keep Electron's default accelerators: on macOS, Cmd+C/V/X/Z/A only work in text
      // fields when the Edit menu registers them.
      return { role: item.role, label: item.label };
    case 'submenu':
      return {
        label: item.label,
        submenu: item.items.map((child) => toElectronItem(child, runCommand)),
      };
    case 'command':
      return {
        label: item.label,
        enabled: item.enabled,
        ...(item.checked === undefined ? {} : { type: 'checkbox', checked: item.checked }),
        ...(item.accelerator === undefined
          ? {}
          : // Display only: the renderer's keybinding service handles the key itself, so a
            // user override in keybindings.jsonc can't be shadowed by the native menu.
            { accelerator: item.accelerator, registerAccelerator: false }),
        click: () => {
          runCommand(item.command);
        },
      };
  }
}

/**
 * Build the macOS application menu: the standard app and Window menus around the menus the
 * renderer supplies.
 */
export function buildMacMenuTemplate(
  appName: string,
  model: MenuBarModel,
  runCommand: (command: string) => void,
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          registerAccelerator: false,
          click: () => {
            runCommand('workbench.action.openSettings');
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    ...model.map((menu): MenuItemConstructorOptions => ({
      label: menu.label,
      submenu: menu.items.map((item) => toElectronItem(item, runCommand)),
    })),
    {
      label: 'Window',
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
}
