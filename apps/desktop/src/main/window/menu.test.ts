import { describe, expect, it, vi } from 'vitest';

import { buildMacMenuTemplate } from './menu';

describe('buildMacMenuTemplate', () => {
  const model = [
    {
      label: 'Edit',
      items: [
        { kind: 'role' as const, role: 'copy' as const, label: 'Copy' },
        { kind: 'separator' as const },
        {
          kind: 'command' as const,
          command: 'workbench.action.showCommands',
          label: 'Command Palette...',
          accelerator: 'Shift+Super+P',
          enabled: true,
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          kind: 'submenu' as const,
          label: 'Appearance',
          items: [
            {
              kind: 'command' as const,
              command: 'workbench.action.togglePanel',
              label: 'Panel',
              enabled: false,
              checked: true,
            },
          ],
        },
      ],
    },
  ];

  it('wraps the renderer menus with the standard app and Window menus', () => {
    const template = buildMacMenuTemplate('Raml KQL', model, vi.fn());
    expect(template.map((menu) => menu.label)).toEqual(['Raml KQL', 'Edit', 'View', 'Window']);
  });

  it('keeps edit roles (their accelerators make Cmd+C work in text fields)', () => {
    const [, edit] = buildMacMenuTemplate('Raml KQL', model, vi.fn());
    const items = edit?.submenu as { role?: string; accelerator?: string }[];
    expect(items[0]).toEqual({ role: 'copy', label: 'Copy' });
  });

  it('command items show the accelerator without registering it, and run via callback', () => {
    const run = vi.fn();
    const [, edit] = buildMacMenuTemplate('Raml KQL', model, run);
    const item = (
      edit?.submenu as { click?: () => void; registerAccelerator?: boolean; accelerator?: string }[]
    )[2];
    expect(item).toMatchObject({ accelerator: 'Shift+Super+P', registerAccelerator: false });
    item?.click?.();
    expect(run).toHaveBeenCalledWith('workbench.action.showCommands');
  });

  it('maps submenus, disabled and checked items', () => {
    const [, , view] = buildMacMenuTemplate('Raml KQL', model, vi.fn());
    const appearance = (view?.submenu as { submenu?: unknown[] }[])[0];
    expect(appearance?.submenu?.[0]).toMatchObject({
      label: 'Panel',
      enabled: false,
      type: 'checkbox',
      checked: true,
    });
  });
});
