import { create } from 'zustand';

/** Status bar item API (spec 05): features and, later, extensions contribute items here. */

export type StatusBarAlignment = 'left' | 'right';
export type StatusBarKind = 'standard' | 'warning' | 'error' | 'prominent' | 'remote';

export interface StatusBarItem {
  id: string;
  alignment: StatusBarAlignment;
  /** Higher priority sits further left (left side) or further right (right side), as in VS Code. */
  priority: number;
  /** Text; `$(icon-name)` renders a codicon. */
  text: string;
  tooltip?: string | undefined;
  ariaLabel?: string | undefined;
  /** Command id run on click. */
  command?: string | undefined;
  kind?: StatusBarKind;
}

export const useStatusBar = create<{ items: Record<string, StatusBarItem> }>(() => ({ items: {} }));

export interface StatusBarItemHandle {
  update(changes: Partial<Omit<StatusBarItem, 'id'>>): void;
  dispose(): void;
}

export function registerStatusBarItem(item: StatusBarItem): StatusBarItemHandle {
  // The item this registration owns. Updates and dispose only touch the entry while it is still
  // ours: a later registration with the same id (e.g. the second workbench start under React
  // StrictMode) must survive an earlier registration's dispose.
  let mine = item;
  useStatusBar.setState((state) => ({ items: { ...state.items, [item.id]: item } }));
  return {
    update(changes) {
      useStatusBar.setState((state) => {
        if (state.items[item.id] !== mine) return state;
        mine = { ...mine, ...changes };
        return { items: { ...state.items, [item.id]: mine } };
      });
    },
    dispose() {
      useStatusBar.setState((state) => {
        if (state.items[item.id] !== mine) return state;
        const { [item.id]: _removed, ...rest } = state.items;
        return { items: rest };
      });
    },
  };
}

/** Items for one side, in display order (left: high priority first; right: low priority first). */
export function sortStatusBarItems(
  items: readonly StatusBarItem[],
  alignment: StatusBarAlignment,
): StatusBarItem[] {
  return items
    .filter((item) => item.alignment === alignment)
    .sort((a, b) => (alignment === 'left' ? b.priority - a.priority : a.priority - b.priority));
}
