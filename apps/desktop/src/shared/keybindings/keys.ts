/**
 * Key strings in VS Code's keybindings.json syntax: `ctrl+shift+p`, `cmd+k cmd+s` (a chord of
 * two presses), `-` removal entries are handled by the keybinding service.
 */

export type Platform = 'darwin' | 'win32' | 'linux';

export interface KeyPress {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Cmd on macOS, the Windows/Super key elsewhere. */
  readonly meta: boolean;
  /** Normalised key name, e.g. `p`, `f1`, `enter`, `\\`. */
  readonly key: string;
}

/** One press, or two presses for a chord. */
export type KeySequence = readonly [KeyPress] | readonly [KeyPress, KeyPress];

const NAMED_KEYS = [
  'enter',
  'escape',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'left',
  'right',
  'up',
  'down',
  'capslock',
  'pausebreak',
  'numpad_multiply',
  'numpad_add',
  'numpad_separator',
  'numpad_subtract',
  'numpad_decimal',
  'numpad_divide',
];
const PUNCTUATION = ['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'];

/** Every key name the parser accepts. */
export const KNOWN_KEYS: ReadonlySet<string> = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `numpad${i}`),
  ...NAMED_KEYS,
  ...PUNCTUATION,
]);

const ALIASES: Record<string, string> = { esc: 'escape', return: 'enter', del: 'delete' };

function parsePress(text: string): KeyPress | undefined {
  // Modifiers and key are joined with `+` (the `+` key itself isn't supported, as in VS Code
  // where it is written `=` with shift).
  const parts = text.toLowerCase().split('+');
  const rawKey = parts.pop();
  if (rawKey === undefined || rawKey === '') return undefined;
  const key = ALIASES[rawKey] ?? rawKey;
  if (!KNOWN_KEYS.has(key)) return undefined;

  const press = { ctrl: false, shift: false, alt: false, meta: false, key };
  for (const modifier of parts) {
    switch (modifier) {
      case 'ctrl':
        press.ctrl = true;
        break;
      case 'shift':
        press.shift = true;
        break;
      case 'alt':
      case 'option':
        press.alt = true;
        break;
      case 'cmd':
      case 'meta':
      case 'win':
      case 'super':
        press.meta = true;
        break;
      default:
        return undefined;
    }
  }
  return press;
}

/** Parse `ctrl+k ctrl+s`; returns undefined for anything malformed. */
export function parseKeySequence(text: string): KeySequence | undefined {
  const presses = text.trim().split(/\s+/).map(parsePress);
  if (presses.length === 1 && presses[0] !== undefined) return [presses[0]];
  if (presses.length === 2 && presses[0] !== undefined && presses[1] !== undefined) {
    return [presses[0], presses[1]];
  }
  return undefined;
}

/** Canonical form used for matching: `ctrl+shift+alt+meta+key`. */
export function pressToString(press: KeyPress): string {
  return [
    press.ctrl ? 'ctrl' : '',
    press.shift ? 'shift' : '',
    press.alt ? 'alt' : '',
    press.meta ? 'meta' : '',
    press.key,
  ]
    .filter((part) => part !== '')
    .join('+');
}

export function sequenceToString(sequence: KeySequence): string {
  return sequence.map(pressToString).join(' ');
}

const MAC_KEY_LABELS: Record<string, string> = {
  enter: '↩',
  escape: '⎋',
  tab: '⇥',
  space: 'Space',
  backspace: '⌫',
  delete: '⌦',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};
const OTHER_KEY_LABELS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  left: 'LeftArrow',
  right: 'RightArrow',
  up: 'UpArrow',
  down: 'DownArrow',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};

function keyLabel(key: string, platform: Platform): string {
  const table = platform === 'darwin' ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  const label = table[key];
  if (label !== undefined) return label;
  if (key.startsWith('numpad')) {
    // numpad0 → NumPad0, numpad_add → NumPad_Add (VS Code's labels)
    return `NumPad${key.slice(6).replace(/_([a-z])/, (_m, c: string) => `_${c.toUpperCase()}`)}`;
  }
  return key.toUpperCase();
}

/** Human-readable label, like VS Code: `⇧⌘P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatKeySequence(sequence: KeySequence, platform: Platform): string {
  return sequence
    .map((press) => {
      if (platform === 'darwin') {
        return (
          (press.ctrl ? '⌃' : '') +
          (press.alt ? '⌥' : '') +
          (press.shift ? '⇧' : '') +
          (press.meta ? '⌘' : '') +
          keyLabel(press.key, platform)
        );
      }
      return [
        press.ctrl ? 'Ctrl' : '',
        press.shift ? 'Shift' : '',
        press.alt ? 'Alt' : '',
        press.meta ? (platform === 'win32' ? 'Windows' : 'Super') : '',
        keyLabel(press.key, platform),
      ]
        .filter((part) => part !== '')
        .join('+');
    })
    .join(' ');
}

/**
 * Electron accelerator for native menus (display only; single presses only because Electron
 * menus can't show chords).
 */
export function toElectronAccelerator(sequence: KeySequence): string | undefined {
  if (sequence.length !== 1) return undefined;
  const [press] = sequence;
  const keyMap: Record<string, string> = {
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
    '=': '=',
  };
  const numpad = /^numpad(\d)$/.exec(press.key)?.[1];
  const numpadOps: Record<string, string> = {
    numpad_add: 'numadd',
    numpad_subtract: 'numsub',
    numpad_multiply: 'nummult',
    numpad_divide: 'numdiv',
    numpad_decimal: 'numdec',
  };
  const key =
    keyMap[press.key] ??
    (numpad === undefined ? undefined : `num${numpad}`) ??
    numpadOps[press.key] ??
    press.key.toUpperCase();
  return [
    press.ctrl ? 'Ctrl' : '',
    press.shift ? 'Shift' : '',
    press.alt ? 'Alt' : '',
    press.meta ? 'Super' : '',
    key,
  ]
    .filter((part) => part !== '')
    .join('+'); // Electron's `Super` is Cmd on macOS and the Windows/Super key elsewhere.
}
