import { z } from 'zod';

/**
 * Application menu model. The renderer owns commands and keybindings, so it builds the menu
 * (with the user's current keybindings as accelerator labels) and sends it to the main
 * process, which renders it natively on macOS. On Windows and Linux the renderer draws the
 * menu bar itself in the custom title bar.
 */
export const MenuRoleSchema = z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
export type MenuRole = z.infer<typeof MenuRoleSchema>;

export type MenuItemModel =
  | {
      kind: 'command';
      command: string;
      label: string;
      /** Electron accelerator, for display only. */
      accelerator?: string | undefined;
      enabled: boolean;
      checked?: boolean | undefined;
    }
  | { kind: 'role'; role: MenuRole; label: string; accelerator?: string | undefined }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: MenuItemModel[] };

export const MenuItemModelSchema: z.ZodType<MenuItemModel> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('command'),
      command: z.string().min(1).max(200),
      label: z.string().max(200),
      accelerator: z.string().max(100).optional(),
      enabled: z.boolean(),
      checked: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('role'),
      role: MenuRoleSchema,
      label: z.string().max(200),
      accelerator: z.string().max(100).optional(),
    }),
    z.object({ kind: z.literal('separator') }),
    z.object({
      kind: z.literal('submenu'),
      label: z.string().max(200),
      items: z.array(MenuItemModelSchema).max(100),
    }),
  ]),
);

export const MenuBarModelSchema = z
  .array(z.object({ label: z.string().max(100), items: z.array(MenuItemModelSchema).max(100) }))
  .max(20);
export type MenuBarModel = z.infer<typeof MenuBarModelSchema>;
