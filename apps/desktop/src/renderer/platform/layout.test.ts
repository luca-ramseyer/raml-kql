import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT_STATE, SIDEBAR_MIN_WIDTH } from '../../shared/layout/layout-state';

import {
  initLayout,
  setPanelHeight,
  setSidebarWidth,
  showView,
  toggleMaximizedPanel,
  togglePanel,
  toggleSidebar,
  useLayout,
} from './layout';

const save = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  save.mockClear();
  initLayout(DEFAULT_LAYOUT_STATE, save);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('layout', () => {
  it('toggles the sidebar and panel', () => {
    toggleSidebar();
    togglePanel();
    expect(useLayout.getState().sidebar.visible).toBe(false);
    expect(useLayout.getState().panel.visible).toBe(false);
    toggleSidebar(true);
    expect(useLayout.getState().sidebar.visible).toBe(true);
  });

  it('clicking the active view hides the sidebar (VS Code behaviour)', () => {
    showView('workbench.view.history', true);
    expect(useLayout.getState().sidebar).toMatchObject({
      visible: true,
      activeView: 'workbench.view.history',
    });
    showView('workbench.view.history', true);
    expect(useLayout.getState().sidebar.visible).toBe(false);
    showView('workbench.view.history');
    expect(useLayout.getState().sidebar.visible).toBe(true);
  });

  it('clamps sizes', () => {
    setSidebarWidth(10);
    expect(useLayout.getState().sidebar.width).toBe(SIDEBAR_MIN_WIDTH);
    toggleMaximizedPanel();
    setPanelHeight(333.6);
    expect(useLayout.getState().panel).toMatchObject({ height: 334, maximized: false });
  });

  it('persists changes, debounced', () => {
    toggleSidebar();
    toggleSidebar();
    togglePanel();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(useLayout.getState());
  });
});
