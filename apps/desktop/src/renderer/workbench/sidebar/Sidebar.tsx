import { executeCommand } from '../../platform/commands';
import { useLayout } from '../../platform/layout';
import { Codicon } from '../common/Codicon';
import { getView, VIEWS } from '../views';

import './Sidebar.css';

export function Sidebar(): React.JSX.Element {
  const activeView = useLayout((state) => state.sidebar.activeView);
  const view = getView(activeView) ?? VIEWS[0];
  if (view === undefined) return <aside className="part sidebar" />;
  const Content = view.component;
  return (
    <aside className="part sidebar" aria-label={`${view.title} view`} data-view={view.id}>
      <div className="composite-title">
        <h2 className="composite-title-label">{view.title}</h2>
        <div
          className="composite-title-actions"
          role="toolbar"
          aria-label={`${view.title} actions`}
        >
          {(view.actions ?? []).map((action) => (
            <button
              key={action.command}
              type="button"
              className="action-item"
              title={action.title}
              aria-label={action.title}
              onClick={() => void executeCommand(action.command)}
            >
              <Codicon name={action.icon} />
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-content">
        <Content />
      </div>
    </aside>
  );
}
