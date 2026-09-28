import { describe, expect, it } from 'vitest';

import { registerStatusBarItem, sortStatusBarItems, useStatusBar } from './statusbar';

describe('status bar items', () => {
  it('registers, updates and disposes', () => {
    const handle = registerStatusBarItem({ id: 'x', alignment: 'left', priority: 1, text: 'a' });
    handle.update({ text: '$(bell) b' });
    expect(useStatusBar.getState().items['x']?.text).toBe('$(bell) b');
    handle.dispose();
    expect(useStatusBar.getState().items['x']).toBeUndefined();
  });

  it('orders like VS Code: higher priority further out on each side', () => {
    const items = [
      { id: 'l1', alignment: 'left' as const, priority: 1, text: '' },
      { id: 'l9', alignment: 'left' as const, priority: 9, text: '' },
      { id: 'r1', alignment: 'right' as const, priority: 1, text: '' },
      { id: 'r9', alignment: 'right' as const, priority: 9, text: '' },
    ];
    expect(sortStatusBarItems(items, 'left').map((i) => i.id)).toEqual(['l9', 'l1']);
    expect(sortStatusBarItems(items, 'right').map((i) => i.id)).toEqual(['r1', 'r9']);
  });
});
