import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Codicon } from './Codicon';

/** Menu entries for context menus, the Manage menu and the custom menu bar. */
export type MenuEntry =
  | {
      kind: 'item';
      label: string;
      keybinding?: string | undefined;
      enabled?: boolean;
      checked?: boolean | undefined;
      run: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; entries: MenuEntry[] };

type Actionable = Exclude<MenuEntry, { kind: 'separator' }>;

function isEnabled(entry: MenuEntry): entry is Actionable {
  return entry.kind === 'submenu' || (entry.kind === 'item' && entry.enabled !== false);
}

/**
 * A VS Code-style menu popup. Keyboard: Up/Down move, Enter/Space run, Right opens a submenu,
 * Left/Escape close. Clicking outside closes all menus.
 */
export function ContextMenu({
  entries,
  x,
  y,
  onClose,
  onNavigateOut,
  autoFocus = true,
  label,
}: {
  entries: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  /** Left/Right at the top level (menu bar uses this to move between menus). */
  onNavigateOut?: (direction: 'left' | 'right') => void;
  autoFocus?: boolean;
  label: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number } | undefined>();
  const [position, setPosition] = useState({ x, y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!(target instanceof Element) || target.closest('.context-menu') === null) onClose();
    };
    const onBlur = (): void => {
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  const openSubmenu = (index: number): void => {
    const row = ref.current?.querySelectorAll<HTMLElement>('.context-menu-row')[index];
    if (row === undefined) return;
    const rect = row.getBoundingClientRect();
    setSubmenu({ index, x: rect.right - 2, y: rect.top - 4 });
  };

  const run = (entry: MenuEntry, index: number): void => {
    if (!isEnabled(entry)) return;
    if (entry.kind === 'submenu') {
      openSubmenu(index);
      return;
    }
    onClose();
    entry.run();
  };

  const move = (step: 1 | -1): void => {
    if (entries.length === 0) return;
    let next = active;
    for (let i = 0; i < entries.length; i++) {
      next = (next + step + entries.length) % entries.length;
      const entry = entries[next];
      if (entry !== undefined && isEnabled(entry)) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const entry = entries[active];
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Enter':
      case ' ':
        if (entry !== undefined) run(entry, active);
        break;
      case 'ArrowRight':
        if (entry?.kind === 'submenu') openSubmenu(active);
        else onNavigateOut?.('right');
        break;
      case 'ArrowLeft':
        if (onNavigateOut === undefined) onClose();
        else onNavigateOut('left');
        break;
      case 'Escape':
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const openedSubmenu = submenu === undefined ? undefined : entries[submenu.index];

  return createPortal(
    <>
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{ left: position.x, top: position.y }}
        onKeyDown={onKeyDown}
      >
        {entries.map((entry, index) =>
          entry.kind === 'separator' ? (
            <div key={index} className="context-menu-separator" role="separator" />
          ) : (
            <div
              key={index}
              role="menuitem"
              aria-disabled={!isEnabled(entry)}
              aria-haspopup={entry.kind === 'submenu' ? 'menu' : undefined}
              className={`context-menu-row${index === active ? ' active' : ''}${
                isEnabled(entry) ? '' : ' disabled'
              }`}
              onPointerEnter={() => {
                setActive(index);
                if (entry.kind === 'submenu') openSubmenu(index);
                else setSubmenu(undefined);
              }}
              onClick={() => {
                run(entry, index);
              }}
            >
              <span className="context-menu-check">
                {entry.kind === 'item' && entry.checked === true ? <Codicon name="check" /> : null}
              </span>
              <span className="context-menu-label">{entry.label}</span>
              {entry.kind === 'item' && entry.keybinding !== undefined ? (
                <span className="context-menu-keybinding">{entry.keybinding}</span>
              ) : null}
              {entry.kind === 'submenu' ? (
                <Codicon name="chevron-right" className="context-menu-submenu-indicator" />
              ) : null}
            </div>
          ),
        )}
      </div>
      {openedSubmenu?.kind === 'submenu' && submenu !== undefined ? (
        <ContextMenu
          entries={openedSubmenu.entries}
          x={submenu.x}
          y={submenu.y}
          label={openedSubmenu.label}
          onNavigateOut={(direction) => {
            if (direction === 'left') {
              setSubmenu(undefined);
              ref.current?.focus();
            }
          }}
          onClose={() => {
            setSubmenu(undefined);
            onClose();
          }}
        />
      ) : null}
    </>,
    document.body,
  );
}
