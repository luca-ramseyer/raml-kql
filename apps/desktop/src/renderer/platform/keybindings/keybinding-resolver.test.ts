import { describe, expect, it } from 'vitest';

import type { DefaultKeybinding } from '../../../shared/keybindings/keybindings';
import { parseKeySequence, type KeyPress } from '../../../shared/keybindings/keys';

import { dispatchKeyPress, primaryKeybinding, resolveKeybindings } from './keybinding-resolver';

const press = (text: string): KeyPress => {
  const sequence = parseKeySequence(text);
  if (sequence === undefined) throw new Error(text);
  return sequence[0];
};

const defaults: DefaultKeybinding[] = [
  { command: 'toggle.sidebar', key: 'ctrl+b', mac: 'cmd+b' },
  { command: 'open.keybindings', key: 'ctrl+k ctrl+s', mac: 'cmd+k cmd+s' },
  { command: 'close.quickOpen', key: 'escape', when: 'inQuickOpen' },
  { command: 'hide.toasts', key: 'escape', when: 'toasts' },
];

describe('resolveKeybindings', () => {
  it('uses platform-specific keys', () => {
    const { bindings } = resolveKeybindings(defaults, [], 'darwin');
    expect(primaryKeybinding(bindings, 'toggle.sidebar')).toEqual([press('cmd+b')]);
    const win = resolveKeybindings(defaults, [], 'win32').bindings;
    expect(primaryKeybinding(win, 'toggle.sidebar')).toEqual([press('ctrl+b')]);
  });

  it('adds user bindings after defaults, so they win', () => {
    const { bindings } = resolveKeybindings(
      defaults,
      [{ key: 'cmd+b', command: 'my.command' }],
      'darwin',
    );
    expect(dispatchKeyPress(bindings, press('cmd+b'), undefined, {})).toMatchObject({
      kind: 'command',
      binding: { command: 'my.command', source: 'user' },
    });
  });

  it('removes defaults with "-command"', () => {
    const { bindings } = resolveKeybindings(
      defaults,
      [{ key: 'cmd+b', command: '-toggle.sidebar' }],
      'darwin',
    );
    expect(primaryKeybinding(bindings, 'toggle.sidebar')).toBeUndefined();
  });

  it('only removes the default whose when-clause matches, when given', () => {
    const { bindings } = resolveKeybindings(
      defaults,
      [{ key: 'escape', command: '-close.quickOpen', when: 'somethingElse' }],
      'darwin',
    );
    expect(primaryKeybinding(bindings, 'close.quickOpen')).toBeDefined();
  });

  it('reports bad keys and when-clauses instead of throwing', () => {
    const { problems } = resolveKeybindings(
      defaults,
      [
        { key: 'hyper+x', command: 'a' },
        { key: 'ctrl+x', command: 'b', when: 'a &&' },
      ],
      'linux',
    );
    expect(problems).toHaveLength(2);
  });
});

describe('dispatchKeyPress', () => {
  const { bindings } = resolveKeybindings(defaults, [], 'darwin');

  it('ignores unbound keys', () => {
    expect(dispatchKeyPress(bindings, press('cmd+q'), undefined, {})).toEqual({ kind: 'none' });
  });

  it('respects when-clauses', () => {
    expect(dispatchKeyPress(bindings, press('escape'), undefined, {})).toEqual({ kind: 'none' });
    expect(
      dispatchKeyPress(bindings, press('escape'), undefined, { inQuickOpen: true }),
    ).toMatchObject({
      binding: { command: 'close.quickOpen' },
    });
    expect(
      dispatchKeyPress(bindings, press('escape'), undefined, { inQuickOpen: true, toasts: true }),
    ).toMatchObject({ binding: { command: 'hide.toasts' } });
  });

  it('handles chords', () => {
    const first = dispatchKeyPress(bindings, press('cmd+k'), undefined, {});
    expect(first).toEqual({ kind: 'chord', first: press('cmd+k') });
    expect(dispatchKeyPress(bindings, press('cmd+s'), press('cmd+k'), {})).toMatchObject({
      kind: 'command',
      binding: { command: 'open.keybindings' },
    });
    expect(dispatchKeyPress(bindings, press('cmd+x'), press('cmd+k'), {})).toEqual({
      kind: 'chordMiss',
      first: press('cmd+k'),
      second: press('cmd+x'),
    });
  });
});
