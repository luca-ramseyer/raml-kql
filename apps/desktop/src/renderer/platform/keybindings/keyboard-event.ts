import { KNOWN_KEYS, type KeyPress } from '../../../shared/keybindings/keys';

const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end',
  Tab: 'tab',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Space: 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  CapsLock: 'capslock',
  Pause: 'pausebreak',
  NumpadMultiply: 'numpad_multiply',
  NumpadAdd: 'numpad_add',
  NumpadSubtract: 'numpad_subtract',
  NumpadDecimal: 'numpad_decimal',
  NumpadDivide: 'numpad_divide',
};

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

/** The part of a KeyboardEvent we need (keeps this testable without a DOM). */
export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Convert a key event to a {@link KeyPress}. Letters, digits and unshifted punctuation use the
 * character the keyboard layout produced (`event.key`), so shortcuts follow the printed labels
 * (QWERTZ, AZERTY). Everything else — named keys, and characters changed by Shift/Alt — falls
 * back to the physical key (`event.code`), like VS Code's keyCode dispatch.
 */
export function keyPressFromEvent(event: KeyboardEventLike): KeyPress | undefined {
  if (MODIFIER_KEYS.has(event.key)) return undefined;

  let key: string | undefined;
  const lower = event.key.length === 1 ? event.key.toLowerCase() : undefined;
  if (lower !== undefined && KNOWN_KEYS.has(lower) && /^[a-z0-9`\-=[\]\\;',./]$/.test(lower)) {
    key = lower;
  }
  if (key === undefined) {
    const { code } = event;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^Numpad[0-9]$/.test(code)) key = `numpad${code.slice(6)}`;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code.toLowerCase();
    else key = CODE_TO_KEY[code];
  }
  if (key === undefined) return undefined;

  return {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    key,
  };
}
