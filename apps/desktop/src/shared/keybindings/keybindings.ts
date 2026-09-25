import { z } from 'zod';

import type { Platform } from './keys';

/**
 * One entry of `keybindings.jsonc`, in VS Code's format. A `command` starting with `-` removes
 * a matching default keybinding instead of adding one.
 */
export const KeybindingEntrySchema = z.object({
  key: z.string().min(1).max(100),
  command: z.string().min(1).max(200),
  when: z.string().max(1000).optional(),
  args: z.unknown().optional(),
});
export type KeybindingEntry = z.infer<typeof KeybindingEntrySchema>;

/** A default keybinding with optional per-platform keys (like VS Code's `mac`/`win`/`linux`). */
export interface DefaultKeybinding {
  readonly command: string;
  /** Key on Windows and Linux (and macOS unless `mac` is set). */
  readonly key: string;
  readonly mac?: string;
  readonly win?: string;
  readonly linux?: string;
  readonly when?: string;
}

/**
 * Built-in keybindings. VS Code defaults where they exist (spec 05); app-specific views use
 * the shortcuts from spec 05. User entries in keybindings.jsonc are applied on top.
 *
 * Order matters: when a command has several keybindings, the *last* one is the primary one
 * shown in menus and the palette (as in VS Code, where secondary keybindings sort first).
 */
export const DEFAULT_KEYBINDINGS: readonly DefaultKeybinding[] = [
  // Quick input
  { command: 'workbench.action.showCommands', key: 'f1' },
  { command: 'workbench.action.showCommands', key: 'ctrl+shift+p', mac: 'cmd+shift+p' },
  { command: 'workbench.action.quickOpen', key: 'ctrl+e', mac: 'cmd+e' },
  { command: 'workbench.action.quickOpen', key: 'ctrl+p', mac: 'cmd+p' },

  // Query editor (spec 05)
  { command: 'query.new', key: 'ctrl+n', mac: 'cmd+n' },
  // Monaco handles these itself while it has focus; the entries show the shortcuts in the
  // palette and work from the query toolbar.
  {
    command: 'editor.action.formatDocument',
    key: 'shift+alt+f',
    linux: 'ctrl+shift+i',
    when: "editorLangId == 'kusto' && !inputFocus",
  },
  {
    command: 'editor.action.commentLine',
    key: 'ctrl+/',
    mac: 'cmd+/',
    when: "editorLangId == 'kusto' && !inputFocus",
  },
  {
    command: 'actions.find',
    key: 'ctrl+f',
    mac: 'cmd+f',
    when: "editorLangId == 'kusto' && !inputFocus",
  },
  {
    command: 'editor.action.startFindReplaceAction',
    key: 'ctrl+h',
    mac: 'alt+cmd+f',
    when: "editorLangId == 'kusto' && !inputFocus",
  },

  // Layout
  { command: 'workbench.action.toggleSidebarVisibility', key: 'ctrl+b', mac: 'cmd+b' },
  { command: 'workbench.action.togglePanel', key: 'ctrl+j', mac: 'cmd+j' },
  { command: 'workbench.action.toggleFullScreen', key: 'f11', mac: 'ctrl+cmd+f' },

  // Views (spec 05)
  { command: 'workbench.view.targets', key: 'ctrl+shift+e', mac: 'cmd+shift+e' },
  { command: 'workbench.view.library', key: 'ctrl+shift+l', mac: 'cmd+shift+l' },
  { command: 'workbench.view.history', key: 'ctrl+shift+h', mac: 'cmd+shift+h' },
  { command: 'workbench.view.extensions', key: 'ctrl+shift+x', mac: 'cmd+shift+x' },

  // Editors
  { command: 'workbench.action.closeActiveEditor', key: 'ctrl+f4', mac: 'cmd+f4' },
  { command: 'workbench.action.closeActiveEditor', key: 'ctrl+w', mac: 'cmd+w' },

  // Preferences
  { command: 'workbench.action.openSettings', key: 'ctrl+,', mac: 'cmd+,' },
  {
    command: 'workbench.action.openGlobalKeybindingsFile',
    key: 'ctrl+k ctrl+s',
    mac: 'cmd+k cmd+s',
  },
  { command: 'workbench.action.selectTheme', key: 'ctrl+k ctrl+t', mac: 'cmd+k cmd+t' },

  // Window
  { command: 'workbench.action.zoomIn', key: 'ctrl+=', mac: 'cmd+=' },
  { command: 'workbench.action.zoomOut', key: 'ctrl+-', mac: 'cmd+-' },
  { command: 'workbench.action.zoomReset', key: 'ctrl+numpad0', mac: 'cmd+numpad0' },
  { command: 'workbench.action.reloadWindow', key: 'ctrl+r', mac: 'cmd+r', when: 'isDevelopment' },
  { command: 'workbench.action.toggleDevTools', key: 'ctrl+shift+i', mac: 'alt+cmd+i' },

  // Privacy (spec 03)
  {
    command: 'privacy.togglePresentationMode',
    key: 'ctrl+alt+p',
    mac: 'cmd+alt+p',
    when: 'privacyAliasingEnabled',
  },

  // Quick input navigation (only while the quick input is open)
  { command: 'workbench.action.closeQuickOpen', key: 'escape', when: 'inQuickOpen' },

  // Notifications
  {
    command: 'notifications.hideToasts',
    key: 'escape',
    when: 'notificationToastsVisible && !inQuickOpen',
  },
];

/** The key for the given platform. */
export function defaultKeyFor(binding: DefaultKeybinding, platform: Platform): string {
  const specific =
    platform === 'darwin' ? binding.mac : platform === 'win32' ? binding.win : binding.linux;
  return specific ?? binding.key;
}
