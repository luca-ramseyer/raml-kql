import { useState } from 'react';

import type { Platform } from '../../../shared/keybindings/keys';
import { executeCommand, useCommands } from '../../platform/commands';
import { useContextKeys } from '../../platform/context-keys';
import { useKeybindingLabel, useKeybindings } from '../../platform/keybindings/keybinding-service';
import { useLayout } from '../../platform/layout';
import { Codicon } from '../common/Codicon';
import { ContextMenu } from '../common/ContextMenu';
import { buildMenuBarEntries } from '../menus';

import './TitleBar.css';

/** Custom menu bar for Windows and Linux (macOS uses the native menu). */
function MenuBar({ platform }: { platform: Platform }): React.JSX.Element {
  // Rebuild when commands, keybindings or context keys change.
  useCommands((state) => state.commands);
  useKeybindings((state) => state.bindings);
  useContextKeys((state) => state.values);
  const menus = buildMenuBarEntries(platform);
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | undefined>();

  const openAt = (index: number): void => {
    const button = document.querySelectorAll<HTMLElement>('.menubar-item')[index];
    if (button === undefined) return;
    const rect = button.getBoundingClientRect();
    setOpen({ index, x: rect.left, y: rect.bottom });
  };
  const current = open === undefined ? undefined : menus[open.index];

  return (
    <div className="menubar" role="menubar" aria-label="Application menu">
      {menus.map((menu, index) => (
        <button
          key={menu.label}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === index}
          className={`menubar-item${open?.index === index ? ' open' : ''}`}
          onClick={() => {
            if (open?.index === index) setOpen(undefined);
            else openAt(index);
          }}
          onPointerEnter={() => {
            if (open !== undefined && open.index !== index) openAt(index);
          }}
        >
          {menu.label}
        </button>
      ))}
      {current === undefined || open === undefined ? null : (
        <ContextMenu
          key={open.index}
          label={current.label}
          entries={current.entries}
          x={open.x}
          y={open.y}
          onClose={() => {
            setOpen(undefined);
          }}
          onNavigateOut={(direction) => {
            const step = direction === 'right' ? 1 : -1;
            openAt((open.index + step + menus.length) % menus.length);
          }}
        />
      )}
    </div>
  );
}

function CommandCenter(): React.JSX.Element {
  const keybinding = useKeybindingLabel('workbench.action.quickOpen');
  return (
    <button
      type="button"
      className="command-center"
      aria-label="Search queries, commands"
      title={keybinding === undefined ? 'Search' : `Search (${keybinding})`}
      onClick={() => void executeCommand('workbench.action.quickOpen')}
    >
      <Codicon name="search" />
      <span className="command-center-label">Search queries, commands…</span>
    </button>
  );
}

function LayoutControls(): React.JSX.Element {
  const sidebarVisible = useLayout((state) => state.sidebar.visible);
  const panelVisible = useLayout((state) => state.panel.visible);
  return (
    <div className="layout-controls">
      <button
        type="button"
        className="action-item"
        title="Toggle Primary Side Bar"
        aria-label="Toggle Primary Side Bar"
        aria-pressed={sidebarVisible}
        onClick={() => void executeCommand('workbench.action.toggleSidebarVisibility')}
      >
        <Codicon name={sidebarVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
      </button>
      <button
        type="button"
        className="action-item"
        title="Toggle Panel"
        aria-label="Toggle Panel"
        aria-pressed={panelVisible}
        onClick={() => void executeCommand('workbench.action.togglePanel')}
      >
        <Codicon name={panelVisible ? 'layout-panel' : 'layout-panel-off'} />
      </button>
    </div>
  );
}

export function TitleBar({
  platform,
  fullScreen,
}: {
  platform: Platform;
  fullScreen: boolean;
}): React.JSX.Element {
  const mac = platform === 'darwin';
  return (
    <header
      className={`part titlebar ${mac ? 'titlebar-mac' : 'titlebar-custom'}${fullScreen ? ' fullscreen' : ''}`}
    >
      <div className="titlebar-left">{mac ? null : <MenuBar platform={platform} />}</div>
      <div className="titlebar-center">
        <CommandCenter />
      </div>
      <div className="titlebar-right">
        <LayoutControls />
      </div>
    </header>
  );
}
