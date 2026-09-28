import { describe, expect, it } from 'vitest';

import {
  formatKeySequence,
  parseKeySequence,
  sequenceToString,
  toElectronAccelerator,
} from './keys';

describe('parseKeySequence', () => {
  it.each([
    ['ctrl+shift+p', 'ctrl+shift+p'],
    ['Shift+Ctrl+P', 'ctrl+shift+p'],
    ['cmd+k cmd+s', 'meta+k meta+s'],
    ['alt+cmd+i', 'alt+meta+i'],
    ['f1', 'f1'],
    ['ctrl+\\', 'ctrl+\\'],
    ['ctrl+,', 'ctrl+,'],
    ['ctrl+=', 'ctrl+='],
    ['ctrl+-', 'ctrl+-'],
    ['esc', 'escape'],
    ['ctrl+numpad0', 'ctrl+numpad0'],
    ['win+e', 'meta+e'],
  ])('%s → %s', (input, expected) => {
    const sequence = parseKeySequence(input);
    expect(sequence).toBeDefined();
    expect(sequenceToString(sequence!)).toBe(expected);
  });

  it.each(['', 'ctrl+', 'hyper+p', 'ctrl+notakey', 'a b c', 'ctrl++'])('rejects %j', (input) => {
    expect(parseKeySequence(input)).toBeUndefined();
  });
});

describe('formatKeySequence', () => {
  it('uses symbols on macOS, in VS Code order', () => {
    expect(formatKeySequence(parseKeySequence('cmd+shift+p')!, 'darwin')).toBe('⇧⌘P');
    expect(formatKeySequence(parseKeySequence('ctrl+alt+cmd+f')!, 'darwin')).toBe('⌃⌥⌘F');
    expect(formatKeySequence(parseKeySequence('cmd+k cmd+s')!, 'darwin')).toBe('⌘K ⌘S');
    expect(formatKeySequence(parseKeySequence('escape')!, 'darwin')).toBe('⎋');
  });

  it('uses words elsewhere', () => {
    expect(formatKeySequence(parseKeySequence('ctrl+shift+p')!, 'win32')).toBe('Ctrl+Shift+P');
    expect(formatKeySequence(parseKeySequence('meta+e')!, 'win32')).toBe('Windows+E');
    expect(formatKeySequence(parseKeySequence('meta+e')!, 'linux')).toBe('Super+E');
    expect(formatKeySequence(parseKeySequence('ctrl+numpad0')!, 'linux')).toBe('Ctrl+NumPad0');
    expect(formatKeySequence(parseKeySequence('up')!, 'win32')).toBe('UpArrow');
  });
});

describe('toElectronAccelerator', () => {
  it('converts single presses', () => {
    expect(toElectronAccelerator(parseKeySequence('cmd+shift+p')!)).toBe('Shift+Super+P');
    expect(toElectronAccelerator(parseKeySequence('ctrl+,')!)).toBe('Ctrl+,');
    expect(toElectronAccelerator(parseKeySequence('ctrl+numpad0')!)).toBe('Ctrl+num0');
    expect(toElectronAccelerator(parseKeySequence('f11')!)).toBe('F11');
  });

  it('has no accelerator for chords', () => {
    expect(toElectronAccelerator(parseKeySequence('ctrl+k ctrl+s')!)).toBeUndefined();
  });
});
