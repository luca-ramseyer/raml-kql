import { create } from 'zustand';

import {
  DEFAULT_LAYOUT_STATE,
  PANEL_MIN_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  type LayoutState,
} from '../../shared/layout/layout-state';

/** Workbench layout (sidebar/panel visibility and sizes), persisted to `state/ui-layout.json`. */
export const useLayout = create<LayoutState>(() => DEFAULT_LAYOUT_STATE);

let persist: ((state: LayoutState) => void) | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** Load the stored layout and start persisting changes (debounced). */
export function initLayout(initial: LayoutState, save: (state: LayoutState) => void): void {
  useLayout.setState(initial, true);
  persist = save;
}

function update(recipe: (state: LayoutState) => LayoutState): void {
  useLayout.setState(recipe(useLayout.getState()), true);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist?.(useLayout.getState());
  }, 300);
}

export function toggleSidebar(visible?: boolean): void {
  update((s) => ({ ...s, sidebar: { ...s.sidebar, visible: visible ?? !s.sidebar.visible } }));
}

/**
 * Show a sidebar view. Like VS Code, running the command for the view that's already showing
 * hides the sidebar when `toggle` is set (clicking the active activity bar icon).
 */
export function showView(viewId: string, toggle = false): void {
  update((s) => {
    if (toggle && s.sidebar.visible && s.sidebar.activeView === viewId) {
      return { ...s, sidebar: { ...s.sidebar, visible: false } };
    }
    return { ...s, sidebar: { ...s.sidebar, visible: true, activeView: viewId } };
  });
}

export function setSidebarWidth(width: number): void {
  update((s) => ({
    ...s,
    sidebar: { ...s.sidebar, width: Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)) },
  }));
}

export function togglePanel(visible?: boolean): void {
  update((s) => ({ ...s, panel: { ...s.panel, visible: visible ?? !s.panel.visible } }));
}

export function toggleMaximizedPanel(): void {
  update((s) => ({ ...s, panel: { ...s.panel, visible: true, maximized: !s.panel.maximized } }));
}

export function setPanelHeight(height: number): void {
  update((s) => ({
    ...s,
    panel: { ...s.panel, height: Math.max(PANEL_MIN_HEIGHT, Math.round(height)), maximized: false },
  }));
}

export function showPanelTab(tab: string): void {
  update((s) => ({ ...s, panel: { ...s.panel, visible: true, activeTab: tab } }));
}
