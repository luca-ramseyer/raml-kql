import { useCallback, useEffect, useRef } from 'react';

import type { Platform } from '../../shared/keybindings/keys';
import { PANEL_MIN_HEIGHT, SIDEBAR_MIN_WIDTH } from '../../shared/layout/layout-state';
import { handleKeyDown } from '../platform/keybindings/keybinding-service';
import {
  setPanelHeight,
  setSidebarWidth,
  togglePanel,
  toggleSidebar,
  useLayout,
} from '../platform/layout';
import { useSetting } from '../platform/settings';

import { ActivityBar } from './activitybar/ActivityBar';
import { Sash } from './common/Sash';
import { EditorArea } from './editor/EditorArea';
import { Notifications } from './notifications/Notifications';
import { Panel } from './panel/Panel';
import { QuickInput } from './quickinput/QuickInput';
import { Sidebar } from './sidebar/Sidebar';
import { StatusBar } from './statusbar/StatusBar';
import { TitleBar } from './titlebar/TitleBar';

import './workbench.css';

/** Minimum editor height kept visible when the panel is resized, as in VS Code. */
const EDITOR_MIN_HEIGHT = 70;
/** Minimum editor width kept visible when the sidebar is resized. */
const EDITOR_MIN_WIDTH = 220;

export function Workbench({
  platform,
  fullScreen,
}: {
  platform: Platform;
  fullScreen: boolean;
}): React.JSX.Element {
  const sidebar = useLayout((state) => state.sidebar);
  const panel = useLayout((state) => state.panel);
  const statusBarVisible = useSetting('workbench.statusBar.visible');
  const editorColumn = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      handleKeyDown(event);
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  const onSidebarDrag = useCallback((delta: number) => {
    const next = dragStart.current + delta;
    if (next < SIDEBAR_MIN_WIDTH / 2) {
      toggleSidebar(false); // dragging well past the minimum collapses it, like VS Code
      return;
    }
    toggleSidebar(true);
    const max = window.innerWidth - 48 - EDITOR_MIN_WIDTH;
    setSidebarWidth(Math.min(Math.max(next, SIDEBAR_MIN_WIDTH), max));
  }, []);

  const onPanelDrag = useCallback((delta: number) => {
    const next = dragStart.current - delta;
    if (next < PANEL_MIN_HEIGHT / 2) {
      togglePanel(false);
      return;
    }
    togglePanel(true);
    const columnHeight = editorColumn.current?.clientHeight ?? window.innerHeight;
    setPanelHeight(Math.min(Math.max(next, PANEL_MIN_HEIGHT), columnHeight - EDITOR_MIN_HEIGHT));
  }, []);

  return (
    <div className={`workbench platform-${platform}`} data-testid="workbench">
      <TitleBar platform={platform} fullScreen={fullScreen} />
      <div className="workbench-main">
        <ActivityBar />
        {sidebar.visible ? (
          <>
            <div className="sidebar-container" style={{ width: sidebar.width }}>
              <Sidebar />
            </div>
            <Sash
              orientation="vertical"
              label="Resize Primary Side Bar"
              onDragStart={() => {
                dragStart.current = sidebar.width;
              }}
              onDrag={onSidebarDrag}
              onReset={() => {
                setSidebarWidth(300);
              }}
            />
          </>
        ) : null}
        <div className="editor-column" ref={editorColumn}>
          {panel.visible && panel.maximized ? null : <EditorArea />}
          {panel.visible ? (
            <>
              {panel.maximized ? null : (
                <Sash
                  orientation="horizontal"
                  label="Resize Panel"
                  onDragStart={() => {
                    dragStart.current = panel.height;
                  }}
                  onDrag={onPanelDrag}
                  onReset={() => {
                    setPanelHeight(280);
                  }}
                />
              )}
              <div
                className="panel-container"
                style={panel.maximized ? { flex: 1 } : { height: panel.height }}
              >
                <Panel />
              </div>
            </>
          ) : null}
        </div>
      </div>
      {statusBarVisible ? <StatusBar /> : null}
      <QuickInput />
      <Notifications />
    </div>
  );
}
