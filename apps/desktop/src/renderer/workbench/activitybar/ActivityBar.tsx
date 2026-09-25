import { useState } from 'react';

import { executeCommand } from '../../platform/commands';
import { keybindingLabel, useKeybindings } from '../../platform/keybindings/keybinding-service';
import { showView, useLayout } from '../../platform/layout';
import { Codicon } from '../common/Codicon';
import { ContextMenu, type MenuEntry } from '../common/ContextMenu';
import { useViews, type ViewDescriptor } from '../views';

import './ActivityBar.css';

function manageMenu(): MenuEntry[] {
  const item = (label: string, command: string): MenuEntry => ({
    kind: 'item',
    label,
    keybinding: keybindingLabel(command),
    run: () => void executeCommand(command),
  });
  return [
    item('Command Palette...', 'workbench.action.showCommands'),
    { kind: 'separator' },
    item('Settings', 'workbench.action.openSettings'),
    item('Keyboard Shortcuts', 'workbench.action.openGlobalKeybindingsFile'),
    { kind: 'separator' },
    item('Themes: Color Theme', 'workbench.action.selectTheme'),
  ];
}

const noBadge = (): number => 0;

function ActivityItem({
  view,
  active,
}: {
  view: ViewDescriptor;
  active: boolean;
}): React.JSX.Element {
  // Re-render when keybindings change so the tooltip stays right.
  useKeybindings((state) => state.bindings);
  const keybinding = keybindingLabel(view.id);
  const badge = (view.useBadge ?? noBadge)();
  const title =
    (keybinding === undefined ? view.title : `${view.title} (${keybinding})`) +
    (badge > 0 ? ` - ${String(badge)} need${badge === 1 ? 's' : ''} attention` : '');
  return (
    <li role="none">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={view.title}
        title={title}
        className={`activity-item${active ? ' checked' : ''}`}
        onClick={() => {
          showView(view.id, true);
        }}
      >
        <Codicon name={view.icon} />
        {badge > 0 ? (
          <span className="activity-badge" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
        <span className="active-item-indicator" />
      </button>
    </li>
  );
}

export function ActivityBar(): React.JSX.Element {
  const { visible, activeView } = useLayout((state) => state.sidebar);
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>();
  const views = useViews();

  const renderViews = (position: 'top' | 'bottom'): React.JSX.Element[] =>
    views
      .filter((view) => view.position === position)
      .map((view) => (
        <ActivityItem key={view.id} view={view} active={visible && activeView === view.id} />
      ));

  return (
    <nav className="part activitybar" aria-label="Activity Bar">
      <ul className="activitybar-actions" role="tablist" aria-orientation="vertical">
        {renderViews('top')}
      </ul>
      <ul
        className="activitybar-actions activitybar-bottom"
        role="tablist"
        aria-orientation="vertical"
      >
        {renderViews('bottom')}
        <li role="none">
          <button
            type="button"
            className="activity-item"
            title="Manage"
            aria-label="Manage"
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right, y: rect.bottom - 4 });
            }}
          >
            <Codicon name="settings-gear" />
          </button>
        </li>
      </ul>
      {menu === undefined ? null : (
        <ContextMenu
          label="Manage"
          entries={manageMenu()}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
    </nav>
  );
}
