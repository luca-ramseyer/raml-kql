import { describe, expect, it } from 'vitest';

import { keyPressFromEvent, type KeyboardEventLike } from './keyboard-event';

const event = (partial: Partial<KeyboardEventLike>): KeyboardEventLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...partial,
});

describe('keyPressFromEvent', () => {
  it('uses the produced character for letters (follows the keyboard layout)', () => {
    // QWERTZ: the key labelled Z sits where US has Y.
    expect(keyPressFromEvent(event({ key: 'z', code: 'KeyY', metaKey: true }))).toEqual({
      ctrl: false,
      shift: false,
      alt: false,
      meta: true,
      key: 'z',
    });
  });

  it('lower-cases shifted letters', () => {
    expect(
      keyPressFromEvent(event({ key: 'P', code: 'KeyP', shiftKey: true, metaKey: true }))?.key,
    ).toBe('p');
  });

  it('falls back to the physical key when Shift/Alt change the character', () => {
    expect(keyPressFromEvent(event({ key: '?', code: 'Slash', shiftKey: true }))?.key).toBe('/');
    expect(keyPressFromEvent(event({ key: 'π', code: 'KeyP', altKey: true }))?.key).toBe('p');
  });

  it('maps named keys', () => {
    expect(keyPressFromEvent(event({ key: 'F1', code: 'F1' }))?.key).toBe('f1');
    expect(keyPressFromEvent(event({ key: 'Escape', code: 'Escape' }))?.key).toBe('escape');
    expect(keyPressFromEvent(event({ key: 'ArrowUp', code: 'ArrowUp' }))?.key).toBe('up');
    expect(keyPressFromEvent(event({ key: '0', code: 'Numpad0' }))?.key).toBe('0');
    expect(keyPressFromEvent(event({ key: 'Insert', code: 'Numpad0' }))?.key).toBe('numpad0');
    expect(keyPressFromEvent(event({ key: '\\', code: 'Backslash', ctrlKey: true }))?.key).toBe(
      '\\',
    );
  });

  it('ignores lone modifier presses and unknown keys', () => {
    expect(
      keyPressFromEvent(event({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })),
    ).toBeUndefined();
    expect(keyPressFromEvent(event({ key: 'Unidentified', code: 'Lang1' }))).toBeUndefined();
  });
});
