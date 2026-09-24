import { afterEach, describe, expect, it, vi } from 'vitest';

import { useContextKeys } from '../context-keys';

import {
  acceptQuickInput,
  currentProvider,
  filterQuickPickItems,
  hideQuickInput,
  openQuickAccess,
  registerQuickAccessProvider,
  showQuickPick,
  useQuickInput,
} from './quick-input';

const provider = (prefix: string) => ({
  prefix,
  helpText: prefix,
  placeholder: prefix,
  getItems: () => [],
  onAccept: vi.fn(),
  onCancel: vi.fn(),
});

afterEach(() => {
  hideQuickInput();
});

describe('quick input', () => {
  it('picks the provider by prefix, longest first', () => {
    const disposeDefault = registerQuickAccessProvider(provider(''));
    const disposeCommands = registerQuickAccessProvider(provider('>'));
    openQuickAccess('>tog');
    expect(currentProvider()).toMatchObject({ provider: { prefix: '>' }, filter: 'tog' });
    openQuickAccess('abc');
    expect(currentProvider()).toMatchObject({ provider: { prefix: '' }, filter: 'abc' });
    disposeDefault();
    disposeCommands();
  });

  it('tracks inQuickOpen and calls onAccept after closing', () => {
    const picker = { placeholder: 'x', getItems: () => [], onAccept: vi.fn(), onCancel: vi.fn() };
    showQuickPick(picker, 'filter');
    expect(useContextKeys.getState().values['inQuickOpen']).toBe(true);
    acceptQuickInput({ id: '1', label: 'One' });
    expect(useQuickInput.getState().visible).toBe(false);
    expect(useContextKeys.getState().values['inQuickOpen']).toBe(false);
    expect(picker.onAccept).toHaveBeenCalledWith({ id: '1', label: 'One' }, 'filter');
    expect(picker.onCancel).not.toHaveBeenCalled();
  });

  it('cancels the previous picker when another opens', () => {
    const first = { placeholder: 'a', getItems: () => [], onAccept: vi.fn(), onCancel: vi.fn() };
    showQuickPick(first);
    showQuickPick({ placeholder: 'b', getItems: () => [], onAccept: vi.fn() });
    expect(first.onCancel).toHaveBeenCalledOnce();
  });

  it('filters with highlights, optionally sorted by score', () => {
    const items = [
      { id: 'a', label: 'Toggle Maximized Panel', group: 'x' },
      { id: 'b', label: 'Toggle Panel Visibility', group: 'x' },
      { id: 'c', label: 'Open Settings' },
    ];
    expect(filterQuickPickItems(items, 'toggle pan').map((i) => i.id)).toEqual(['a', 'b']);
    const sorted = filterQuickPickItems(items, 'toggle pan', { sort: true });
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a']);
    expect(sorted[0]?.group).toBeUndefined();
    expect(sorted[0]?.highlights).toEqual([{ start: 0, end: 10 }]);
    expect(filterQuickPickItems(items, '')).toHaveLength(3);
  });
});
